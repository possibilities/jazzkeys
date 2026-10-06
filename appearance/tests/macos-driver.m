/* Test-only writer: cannot name NSGlobalDomain or post the real theme notification. */
#import <Foundation/Foundation.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  @autoreleasepool {
    NSString *domain = @"io.jazzkeys.appearance-test";
    NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:domain];
    [defaults removePersistentDomainForName:domain];
    [defaults synchronize];
    puts("{\"ready\":true}"); fflush(stdout);
    char line[32];
    while (fgets(line, sizeof line, stdin)) {
      NSString *value = !strcmp(line, "dark\n") ? @"Dark" : !strcmp(line, "light\n") ? @"Light" : @"Invalid";
      if (!strcmp(line, "none\n")) [defaults removePersistentDomainForName:domain];
      else if (!strcmp(line, "quit\n")) break;
      else [defaults setPersistentDomain:@{@"AppleInterfaceStyle": value} forName:domain];
      [defaults synchronize];
      [[NSDistributedNotificationCenter defaultCenter] postNotificationName:@"io.jazzkeys.appearance-test.changed" object:nil userInfo:nil deliverImmediately:YES];
    }
    [defaults removePersistentDomainForName:domain];
    [defaults synchronize];
  }
  return 0;
}
