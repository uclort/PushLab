#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#import <Sparkle/SUErrors.h>
#import <fcntl.h>
#import <sys/file.h>

@interface PushLabUpdateController : NSObject <NSApplicationDelegate, SPUUpdaterDelegate>

@property(nonatomic, strong) NSBundle *hostBundle;
@property(nonatomic, strong) SPUStandardUserDriver *userDriver;
@property(nonatomic, strong) SPUUpdater *updater;
@property(nonatomic, assign) BOOL probeMode;
@property(nonatomic, assign) int exitCode;

- (instancetype)initWithHostBundle:(NSBundle *)hostBundle probeMode:(BOOL)probeMode;

@end

@implementation PushLabUpdateController

- (instancetype)initWithHostBundle:(NSBundle *)hostBundle probeMode:(BOOL)probeMode {
	self = [super init];
	if (self != nil) {
		_hostBundle = hostBundle;
		_probeMode = probeMode;
		_exitCode = 0;
	}
	return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
	(void)notification;
	[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
	[NSApp activateIgnoringOtherApps:YES];

	self.userDriver = [[SPUStandardUserDriver alloc] initWithHostBundle:self.hostBundle delegate:nil];
	self.updater = [[SPUUpdater alloc]
		initWithHostBundle:self.hostBundle
		applicationBundle:self.hostBundle
		userDriver:self.userDriver
		delegate:self
	];

	NSError *error = nil;
	if (![self.updater startUpdater:&error]) {
		NSAlert *alert = [[NSAlert alloc] init];
		alert.alertStyle = NSAlertStyleCritical;
		alert.messageText = @"无法检查更新";
		alert.informativeText = error.localizedDescription ?: @"Sparkle 更新组件启动失败。";
		[alert addButtonWithTitle:@"好"];
		[alert runModal];
		[NSApp terminate:nil];
		return;
	}

	if (self.probeMode) {
		[self.updater checkForUpdateInformation];
	} else {
		[self.updater checkForUpdates];
	}
}

- (void)updater:(SPUUpdater *)updater
	didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)updateCheck
	error:(NSError *)error {
	(void)updater;
	(void)updateCheck;
	BOOL noUpdate = [error.domain isEqualToString:SUSparkleErrorDomain] && error.code == SUNoUpdateError;
	if (self.probeMode && noUpdate) {
		fprintf(stdout, "Sparkle Feed 验证通过，当前已是最新版本。\n");
	} else if (self.probeMode && error != nil) {
		fprintf(stderr, "Sparkle 检查失败：%s\n", error.localizedDescription.UTF8String);
		self.exitCode = 2;
	}
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
		[NSApp terminate:nil];
	});
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
	(void)sender;
	return NO;
}

@end

static NSBundle *pushLabBundleFromArguments(void) {
	NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
	if (arguments.count < 2) return nil;

	NSBundle *bundle = [NSBundle bundleWithPath:arguments[1]];
	if (![bundle.bundleIdentifier isEqualToString:@"dev.pushlab.app"]) return nil;
	return bundle;
}

int main(int argc, const char *argv[]) {
	(void)argc;
	(void)argv;
	@autoreleasepool {
		int lockFile = open("/tmp/dev.pushlab.app.sparkle.lock", O_CREAT | O_RDWR, 0600);
		if (lockFile < 0 || flock(lockFile, LOCK_EX | LOCK_NB) != 0) return 0;

		NSBundle *hostBundle = pushLabBundleFromArguments();
		if (hostBundle == nil) return 1;
		BOOL probeMode = [NSProcessInfo.processInfo.arguments containsObject:@"--probe"];

		NSApplication *application = [NSApplication sharedApplication];
		PushLabUpdateController *controller = [[PushLabUpdateController alloc]
			initWithHostBundle:hostBundle
			probeMode:probeMode
		];
		application.delegate = controller;
		[application run];
		return controller.exitCode;
	}
}
