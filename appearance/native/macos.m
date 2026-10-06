/* First-party Foundation observer. No window, settings setter, helper install or permission prompt. */
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#include <signal.h>
#include <stdio.h>
#include <unistd.h>

#ifdef JAZZKEYS_APPEARANCE_TEST
/* Compiled ONLY into a separately named CI fixture, never a production option. */
static NSString * const preferenceDomain = @"io.jazzkeys.appearance-test";
static NSString * const notificationName = @"io.jazzkeys.appearance-test.changed";
#else
#define preferenceDomain NSGlobalDomain
static NSString * const notificationName = @"AppleInterfaceThemeChangedNotification";
#endif

static NSString *lastFrame;
static void emitAppearance(BOOL live) {
  @autoreleasepool {
    /* A fresh defaults object obtains the persistent domain; no synchronize/setter is used. */
    NSUserDefaults *defaults = [[NSUserDefaults alloc] init];
    id value = [defaults persistentDomainForName:preferenceDomain][@"AppleInterfaceStyle"];
    NSString *appearance = value == nil ? @"\"light\"" : [value isEqual:@"Dark"] ? @"\"dark\"" :
      [value isEqual:@"Light"] ? @"\"light\"" : @"null";
    NSString *availability = [appearance isEqual:@"null"] ? @"unavailable" : live ? @"live" : @"read-once";
    NSString *frame = [NSString stringWithFormat:@"{\"v\":1,\"appearance\":%@,\"availability\":\"%@\"}\n", appearance, availability];
    if (![frame isEqual:lastFrame]) {
      if (fputs(frame.UTF8String, stdout) == EOF || fflush(stdout) == EOF) _exit(0);
      lastFrame = frame;
    }
  }
}
@interface AppearanceObserver : NSObject
- (void)changed:(NSNotification *)notification;
@end
@implementation AppearanceObserver
- (void)changed:(NSNotification *)notification {
  (void)notification;
  /* Let the preference-service invalidation finish before the fresh read. */
  dispatch_async(dispatch_get_main_queue(), ^{ emitAppearance(YES); });
}
@end

int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1) return 64;
  signal(SIGPIPE, SIG_IGN);
  @autoreleasepool {
    /* Parent death closes the inherited pipe. This source never consumes commands. */
    dispatch_source_t parent = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
    if (!parent) return 70;
    dispatch_source_set_event_handler(parent, ^{ _exit(0); });
    dispatch_resume(parent);
    AppearanceObserver *observer = [AppearanceObserver new];
    @try {
      [[NSDistributedNotificationCenter defaultCenter] addObserver:observer selector:@selector(changed:) name:notificationName object:nil suspensionBehavior:NSNotificationSuspensionBehaviorDeliverImmediately];
      emitAppearance(YES);
      [[NSRunLoop mainRunLoop] run];
    } @catch (NSException *exception) {
      (void)exception;
      emitAppearance(NO);
    }
    [[NSDistributedNotificationCenter defaultCenter] removeObserver:observer];
    dispatch_source_cancel(parent);
  }
  return 0;
}
