// Read-only Foundation/CoreFoundation/Launch Services metadata probe.
// It never loads bundle code, registers the app, opens a window, or launches it.
#import <Foundation/Foundation.h>
#import <CoreServices/CoreServices.h>
#import <mach/machine.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 64;
        NSString *path = [[NSString stringWithUTF8String:argv[1]] stringByStandardizingPath];
        NSURL *url = [NSURL fileURLWithPath:path isDirectory:YES];
        NSBundle *bundle = [NSBundle bundleWithURL:url];
        NSDictionary *info = bundle.infoDictionary ?: @{};
        CFBundleRef cfBundle = CFBundleCreate(kCFAllocatorDefault, (__bridge CFURLRef)url);
        CFURLRef cfExecutable = cfBundle ? CFBundleCopyExecutableURL(cfBundle) : NULL;
        CFArrayRef cfArchitectures = cfBundle ? CFBundleCopyExecutableArchitectures(cfBundle) : NULL;
        NSArray *architectures = CFBridgingRelease(cfArchitectures) ?: @[];
        NSString *executablePath = cfExecutable ? [(__bridge NSURL *)cfExecutable path] : @"";
        NSString *expectedExecutable = [[path stringByAppendingPathComponent:@"Contents/MacOS"] stringByAppendingPathComponent:@"jazzkeys"];
        NSURL *literalURL = [NSURL fileURLWithPath:expectedExecutable];
        NSArray *literalArchitectures = CFBridgingRelease(CFBundleCopyExecutableArchitecturesForURL((__bridge CFURLRef)literalURL)) ?: @[];
        NSArray *resolvedArchitectures = cfExecutable ? (CFBridgingRelease(CFBundleCopyExecutableArchitecturesForURL(cfExecutable)) ?: @[]) : @[];
        NSDictionary *embeddedInfo = CFBridgingRelease(CFBundleCopyInfoDictionaryForURL((__bridge CFURLRef)literalURL)) ?: @{};
        NSMutableDictionary *embeddedValues = [NSMutableDictionary dictionary];
        for (NSString *key in @[@"CFBundleExecutable", @"CFBundleIdentifier", @"CFBundleName", @"CFBundlePackageType", @"CFBundleInfoDictionaryVersion"]) {
            id value = embeddedInfo[key];
            if ([value isKindOfClass:NSString.class]) embeddedValues[key] = value;
        }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        LSItemInfoRecord item = {0};
        OSStatus status = LSCopyItemInfoForURL((__bridge CFURLRef)url, kLSRequestBasicFlagsOnly, &item);
        BOOL lsIsApplication = (item.flags & kLSItemInfoIsApplication) != 0;
        UInt32 lsFlags = item.flags;
        if (item.extension) CFRelease(item.extension);
#pragma clang diagnostic pop
        id isApplication = nil;
        NSError *resourceError = nil;
        BOOL resourceRead = [url getResourceValue:&isApplication forKey:NSURLIsApplicationKey error:&resourceError];
        BOOL valid = bundle != nil && cfBundle != NULL &&
            [info[@"CFBundleName"] isEqual:@"JazzKeys"] &&
            [info[@"CFBundleDisplayName"] isEqual:@"JazzKeys"] &&
            [info[@"CFBundleExecutable"] isEqual:@"jazzkeys"] &&
            [info[@"CFBundleIdentifier"] isEqual:@"io.jazzkeys.desktop"] &&
            [info[@"CFBundlePackageType"] isEqual:@"APPL"] &&
            [executablePath isEqual:expectedExecutable] &&
            [architectures containsObject:@(CPU_TYPE_ARM64)] &&
            status == noErr && lsIsApplication &&
            resourceRead && [isApplication boolValue];
        NSDictionary *result = @{
            @"schemaVersion": @1, @"probe": @"read-only bundle recognition; no launch", @"verified": @(valid),
            @"bundleCreated": @(bundle != nil), @"cfBundleCreated": @(cfBundle != NULL),
            @"executableResolved": @([executablePath isEqual:expectedExecutable]),
            @"architectures": architectures, @"literalExecutableArchitectures": literalArchitectures, @"resolvedExecutableArchitectures": resolvedArchitectures,
            @"embeddedInfoValues": embeddedValues, @"embeddedInfoKeys": [embeddedInfo.allKeys sortedArrayUsingSelector:@selector(compare:)],
            @"launchServicesStatus": @(status), @"launchServicesFlags": @(lsFlags),
            @"launchServicesRecognizesApplication": @(lsIsApplication),
            @"urlResourceRecognizesApplication": @(resourceRead && [isApplication boolValue]),
            @"bundleName": info[@"CFBundleName"] ?: @"", @"displayName": info[@"CFBundleDisplayName"] ?: @"",
            @"executableName": info[@"CFBundleExecutable"] ?: @"", @"identifier": info[@"CFBundleIdentifier"] ?: @"",
            @"packageType": info[@"CFBundlePackageType"] ?: @"", @"minimumSystemVersion": info[@"LSMinimumSystemVersion"] ?: @"",
            @"systemVersion": NSProcessInfo.processInfo.operatingSystemVersionString,
            @"resourceErrorCode": @(resourceError ? resourceError.code : 0)
        };
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:NULL];
        if (json) { fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout); }
        if (cfExecutable) CFRelease(cfExecutable);
        if (cfBundle) CFRelease(cfBundle);
        return valid ? 0 : 1;
    }
}
