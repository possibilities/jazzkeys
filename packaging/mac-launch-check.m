// Bounded, separately coordinated CI-only Launch Services acceptance.
// Opens only the supplied built JazzKeys app, observes its owned window, and quits it.
// Never accepts permissions, injects input, or changes OS security policy.
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <dispatch/dispatch.h>

static NSArray *errorChain(NSError *error, NSString *path) {
    NSMutableArray *errors = [NSMutableArray array];
    for (NSUInteger i = 0; error && i < 8; i++) {
        [errors addObject:@{@"domain": error.domain ?: @"", @"code": @(error.code),
            @"description": [error.localizedDescription stringByReplacingOccurrencesOfString:path withString:@"<app>"] ?: @""}];
        error = error.userInfo[NSUnderlyingErrorKey];
    }
    return errors;
}
static void tick(void) {
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
}
static BOOL windowServerDataAvailable = NO;
static NSArray *ownedWindows(pid_t pid, NSString *expectedTitle) {
    CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    windowServerDataAvailable = raw != NULL;
    NSArray *windows = CFBridgingRelease(raw) ?: @[];
    NSMutableArray *owned = [NSMutableArray array];
    for (NSDictionary *window in windows) {
        if ([window[(__bridge NSString *)kCGWindowOwnerPID] intValue] != pid ||
            [window[(__bridge NSString *)kCGWindowLayer] intValue] != 0) continue;
        CGRect bounds = CGRectZero;
        if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(__bridge NSString *)kCGWindowBounds], &bounds)) continue;
        if (bounds.size.width < 960 || bounds.size.height < 680) continue;
        NSString *title = window[(__bridge NSString *)kCGWindowName] ?: @"";
        if (title.length && ![title isEqual:expectedTitle]) continue;
        [owned addObject:@{@"width": @(bounds.size.width), @"height": @(bounds.size.height),
            @"title": window[(__bridge NSString *)kCGWindowName] ?: @""}];
    }
    return owned;
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSDictionary *environment = NSProcessInfo.processInfo.environment;
        if (argc != 3 || ![environment[@"GITHUB_ACTIONS"] isEqual:@"true"] ||
            ![environment[@"GITHUB_REPOSITORY"] isEqual:@"possibilities/jazzkeys"] ||
            ![environment[@"GITHUB_REF"] isEqual:@"refs/heads/main"]) return 64;
        NSURL *url = [[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]] isDirectory:YES] URLByResolvingSymlinksInPath];
        NSString *workspace = environment[@"GITHUB_WORKSPACE"];
        if (!workspace.length) return 64;
        NSURL *expectedURL = [[NSURL fileURLWithPath:[workspace stringByAppendingPathComponent:@"dist/launch-current/JazzKeys.app"] isDirectory:YES] URLByResolvingSymlinksInPath];
        NSURL *baselineURL = [[NSURL fileURLWithPath:[workspace stringByAppendingPathComponent:@"dist/launch-baseline/Jazzkeys.app"] isDirectory:YES] URLByResolvingSymlinksInPath];
        BOOL baseline = [url isEqual:baselineURL];
        if (![url isEqual:expectedURL] && !baseline) return 65;
        NSString *expectedTitle = baseline ? @"Jazzkeys" : @"JazzKeys";
        NSString *output = [NSString stringWithUTF8String:argv[2]];
        NSBundle *bundle = [NSBundle bundleWithURL:url];
        if (![url.lastPathComponent isEqual:[expectedTitle stringByAppendingString:@".app"]] ||
            ![bundle.bundleIdentifier isEqual:@"io.jazzkeys.desktop"] ||
            [NSRunningApplication runningApplicationsWithBundleIdentifier:@"io.jazzkeys.desktop"].count != 0) return 65;
        NSWorkspaceOpenConfiguration *config = [NSWorkspaceOpenConfiguration configuration];
        config.promptsUserIfNeeded = NO;
        config.activates = YES;
        config.hides = NO;
        config.hidesOthers = NO;
        config.addsToRecentItems = NO;
        config.allowsRunningApplicationSubstitution = NO;
        config.createsNewApplicationInstance = YES;
        __block BOOL completed = NO;
        __block NSRunningApplication *reportedApplication = nil;
        __block NSError *launchError = nil;
        [NSWorkspace.sharedWorkspace openApplicationAtURL:url configuration:config completionHandler:^(NSRunningApplication *app, NSError *error) {
            dispatch_async(dispatch_get_main_queue(), ^{ reportedApplication = app; launchError = error; completed = YES; });
        }];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:30];
        while (!completed && deadline.timeIntervalSinceNow > 0) tick();
        BOOL launchTimedOut = !completed;
        NSRunningApplication *application = reportedApplication;
        if (launchTimedOut) {
            // Bounded final observation: a delayed completion is a failure, but
            // still reclaim the exact app we asked Launch Services to start.
            deadline = [NSDate dateWithTimeIntervalSinceNow:10];
            while (!application && deadline.timeIntervalSinceNow > 0) {
                application = reportedApplication;
                for (NSRunningApplication *candidate in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"io.jazzkeys.desktop"]) {
                    if ([[candidate.bundleURL URLByResolvingSymlinksInPath] isEqual:url]) { application = candidate; break; }
                }
                tick();
            }
        }
        BOOL identity = application != nil && application.processIdentifier > 0 &&
            [application.bundleIdentifier isEqual:@"io.jazzkeys.desktop"] &&
            [[application.bundleURL URLByResolvingSymlinksInPath] isEqual:url];
        NSArray *windows = @[];
        if (identity) {
            deadline = [NSDate dateWithTimeIntervalSinceNow:20];
            while (!application.terminated && deadline.timeIntervalSinceNow > 0) {
                windows = ownedWindows(application.processIdentifier, expectedTitle);
                if (application.finishedLaunching && windows.count > 0) break;
                tick();
            }
        }
        BOOL launched = identity && !application.terminated && application.finishedLaunching && windows.count > 0;
        BOOL quitRequested = NO, forceAttempted = NO, forceAccepted = NO;
        if (identity && !application.terminated) {
            quitRequested = [application terminate];
            deadline = [NSDate dateWithTimeIntervalSinceNow:5];
            while (!application.terminated && deadline.timeIntervalSinceNow > 0) tick();
            if (!application.terminated) { forceAttempted = YES; forceAccepted = [application forceTerminate]; }
            deadline = [NSDate dateWithTimeIntervalSinceNow:5];
            while (!application.terminated && deadline.timeIntervalSinceNow > 0) tick();
        }
        BOOL cleanupUncertain = (!completed || (application && (!identity || !application.terminated)));
        BOOL passed = completed && !launchTimedOut && launched && quitRequested && !forceAttempted && application.terminated;
        NSDictionary *result = @{@"schemaVersion": @1, @"verified": @(passed),
            @"scope": @"One CI-built app via Launch Services; no user desktop or input injection",
            @"targetKind": baseline ? @"published-demo.2-baseline" : @"current-extracted-archive",
            @"completionReceived": @(completed), @"identityMatched": @(identity),
            @"launchedWithOwnedWindow": @(launched), @"windowServerDataAvailable": @(windowServerDataAvailable), @"windows": windows,
            @"pid": identity ? @(application.processIdentifier) : @0,
            @"quitRequested": @(quitRequested), @"forceAttempted": @(forceAttempted), @"forceAccepted": @(forceAccepted),
            @"launchTimedOut": @(launchTimedOut), @"cleanupUncertain": @(cleanupUncertain),
            @"terminated": @(identity && application.terminated),
            @"permissionPromptsAccepted": @NO, @"errors": errorChain(launchError, url.path)};
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:NULL];
        if (!json || ![json writeToFile:output atomically:YES]) return 74;
        fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
        return passed ? 0 : 1;
    }
}
