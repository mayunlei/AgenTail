#import <Cocoa/Cocoa.h>

static NSString *const ASBBaseHost = @"127.0.0.1";

@interface BridgePanelController : NSViewController
@property(nonatomic) NSInteger port;
@property(nonatomic, strong) NSDictionary *status;
@property(nonatomic, strong) NSTimer *timer;
@property(nonatomic, strong) NSTextField *connectionLabel;
@property(nonatomic, copy) NSString *notice;
- (instancetype)initWithPort:(NSInteger)port;
- (void)refresh;
@end

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSPopover *popover;
@property(nonatomic, strong) BridgePanelController *panel;
@property(nonatomic, strong) NSWindow *welcomeWindow;
@property(nonatomic, strong) NSWindow *debugWindow;
- (void)showPopover;
@end

static NSTextField *Label(NSString *text, CGFloat size, NSFontWeight weight, NSColor *color) {
    NSTextField *label = [NSTextField labelWithString:text ?: @""];
    label.font = [NSFont systemFontOfSize:size weight:weight];
    label.textColor = color ?: NSColor.labelColor;
    label.lineBreakMode = NSLineBreakByTruncatingTail;
    label.maximumNumberOfLines = 1;
    return label;
}

static NSView *Separator(void) {
    NSBox *line = [[NSBox alloc] init];
    line.boxType = NSBoxSeparator;
    return line;
}

static NSString *Initials(NSString *agent) {
    return @{ @"codex": @"CX", @"claude": @"CL", @"opencode": @"OC", @"qoder": @"QD" }[agent] ?: @"AG";
}

static BOOL IsEnglish(NSDictionary *status) {
    return [status[@"config"][@"language"] isEqualToString:@"en"];
}

static NSString *L(BOOL english, NSString *zh, NSString *en) { return english ? en : zh; }

static NSString *ContinuityTitle(NSString *state, BOOL english) {
    if ([state isEqualToString:@"healthy"]) return L(english, @"工作已连续", @"Work is continuous");
    if ([state isEqualToString:@"attention"]) return L(english, @"有会话需要处理", @"Sessions need attention");
    if ([state isEqualToString:@"unverified"]) return L(english, @"已写入，等待验证", @"Written, awaiting verification");
    if ([state isEqualToString:@"ready"]) return L(english, @"同步路径已准备", @"Sync paths are ready");
    return L(english, @"选择至少两个 Agent", @"Choose at least two agents");
}

static NSString *LocalizedErrorMessage(NSError *error, BOOL english) {
    NSString *message = error.localizedDescription ?: L(english, @"操作失败", @"Operation failed");
    if ([message containsString:@"Select at least two agents"]) return L(english, @"开启实时同步前，请至少选择两个 Agent", @"Choose at least two agents before enabling live sync");
    if ([message containsString:@"current sync to finish"]) return L(english, @"当前检查完成后才能开启实时同步", @"Wait for the current check to finish");
    if ([message containsString:@"sync is already running"]) return L(english, @"已有一次检查正在进行", @"A check is already running");
    return message;
}

@implementation BridgePanelController

- (instancetype)initWithPort:(NSInteger)port {
    if ((self = [super init])) {
        _port = port;
        self.preferredContentSize = NSMakeSize(390, 468);
    }
    return self;
}

- (void)loadView {
    self.view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 390, 585)];
    [self render];
}

- (void)viewDidAppear {
    [super viewDidAppear];
    [self refresh];
    if (!self.timer) {
        self.timer = [NSTimer scheduledTimerWithTimeInterval:5.0 target:self selector:@selector(refresh) userInfo:nil repeats:YES];
    }
}

- (void)viewDidDisappear {
    [super viewDidDisappear];
    [self.timer invalidate];
    self.timer = nil;
}

- (void)render {
    for (NSView *child in self.view.subviews.copy) [child removeFromSuperview];
    NSUInteger sessionCount = MIN((NSUInteger)3, [self.status[@"sessions"] count]);
    self.preferredContentSize = NSMakeSize(390, self.status ? 468 + sessionCount * 23 : 250);
    NSStackView *root = [[NSStackView alloc] init];
    root.orientation = NSUserInterfaceLayoutOrientationVertical;
    root.alignment = NSLayoutAttributeLeading;
    root.spacing = 13;
    root.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:root];
    [NSLayoutConstraint activateConstraints:@[
        [root.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:18],
        [root.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-18],
        [root.topAnchor constraintEqualToAnchor:self.view.topAnchor constant:18],
        [root.bottomAnchor constraintLessThanOrEqualToAnchor:self.view.bottomAnchor constant:-14],
    ]];

    [root addArrangedSubview:[self headerView]];
    if (!self.status) {
        [root addArrangedSubview:[self offlineView]];
    } else {
        [root addArrangedSubview:[self continuityView]];
        [root addArrangedSubview:[self controlsView]];
        [root addArrangedSubview:Separator()];
        [root addArrangedSubview:[self agentsView]];
        NSArray *sessions = self.status[@"sessions"];
        if (sessions.count) {
            [root addArrangedSubview:Separator()];
            [root addArrangedSubview:[self sessionsView:sessions]];
        }
    }
    if (self.notice.length) [root addArrangedSubview:Label(self.notice, 10, NSFontWeightMedium, NSColor.systemOrangeColor)];
    [root addArrangedSubview:Separator()];
    [root addArrangedSubview:[self footerView]];
}

- (NSView *)headerView {
    BOOL english = IsEnglish(self.status);
    NSStackView *row = [NSStackView stackViewWithViews:@[]];
    row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    row.alignment = NSLayoutAttributeCenterY;
    row.spacing = 10;
    NSTextField *mark = Label(@"A", 13, NSFontWeightBlack, NSColor.blackColor);
    mark.alignment = NSTextAlignmentCenter;
    mark.backgroundColor = NSColor.controlAccentColor;
    mark.drawsBackground = YES;
    mark.wantsLayer = YES;
    mark.layer.cornerRadius = 8;
    [mark.widthAnchor constraintEqualToConstant:30].active = YES;
    [mark.heightAnchor constraintEqualToConstant:30].active = YES;
    NSStackView *copy = [[NSStackView alloc] init];
    copy.orientation = NSUserInterfaceLayoutOrientationVertical;
    copy.alignment = NSLayoutAttributeLeading;
    copy.spacing = 1;
    [copy addArrangedSubview:Label(@"Agentail", 13, NSFontWeightSemibold, nil)];
    [copy addArrangedSubview:Label(L(english, @"Agent 随心换，上下文不断。", @"Any agent. Same trail."), 9, NSFontWeightMedium, NSColor.secondaryLabelColor)];
    self.connectionLabel = Label(self.status ? L(english, @"本地服务已连接", @"Local service connected") : L(english, @"正在连接本地服务", @"Connecting to local service"), 9, NSFontWeightRegular, NSColor.tertiaryLabelColor);
    [copy addArrangedSubview:self.connectionLabel];
    [row addArrangedSubview:mark];
    [row addArrangedSubview:copy];
    [row addArrangedSubview:[self spacer]];
    NSTextField *dot = Label(self.status ? @"●" : @"●", 11, NSFontWeightRegular, self.status ? NSColor.systemGreenColor : NSColor.systemGrayColor);
    [row addArrangedSubview:dot];
    [row.widthAnchor constraintEqualToConstant:354].active = YES;
    return row;
}

- (NSView *)continuityView {
    BOOL english = IsEnglish(self.status);
    NSDictionary *continuity = self.status[@"continuity"] ?: @{};
    NSNumber *rate = continuity[@"verifiedRate"];
    NSString *state = continuity[@"status"] ?: @"idle";
    NSStackView *box = [[NSStackView alloc] init];
    box.orientation = NSUserInterfaceLayoutOrientationVertical;
    box.alignment = NSLayoutAttributeLeading;
    box.spacing = 6;
    box.edgeInsets = NSEdgeInsetsMake(12, 12, 12, 12);
    box.wantsLayer = YES;
    box.layer.backgroundColor = NSColor.quaternaryLabelColor.CGColor;
    box.layer.cornerRadius = 11;
    NSTextField *score = Label(rate && rate != (id)NSNull.null ? [NSString stringWithFormat:@"%@%%", rate] : @"—", 38, NSFontWeightBold, nil);
    [box addArrangedSubview:score];
    NSInteger conflicts = [continuity[@"conflicts"] integerValue];
    NSString *conflictTitle = english ? [NSString stringWithFormat:@"%ld concurrent edits need a decision", (long)conflicts] : [NSString stringWithFormat:@"%ld 个并行修改待决策", (long)conflicts];
    [box addArrangedSubview:Label(conflicts ? conflictTitle : ContinuityTitle(state, english), 14, NSFontWeightSemibold, nil)];
    NSInteger selected = [continuity[@"selectedAgents"] integerValue];
    NSInteger connected = [continuity[@"connectedAgents"] integerValue];
    NSInteger sessions = [continuity[@"sessions"] integerValue];
    NSInteger attention = [continuity[@"attention"] integerValue];
    NSString *metrics = english
        ? [NSString stringWithFormat:@"Selected / detected  %ld / %ld     Sessions  %ld     Review  %ld", (long)selected, (long)connected, (long)sessions, (long)attention]
        : [NSString stringWithFormat:@"已选 / 检测  %ld / %ld       连续会话  %ld       需处理  %ld", (long)selected, (long)connected, (long)sessions, (long)attention];
    [box addArrangedSubview:Label(metrics, 10, NSFontWeightMedium, NSColor.secondaryLabelColor)];
    [box.widthAnchor constraintEqualToConstant:354].active = YES;
    return box;
}

- (NSView *)controlsView {
    BOOL english = IsEnglish(self.status);
    NSDictionary *config = self.status[@"config"] ?: @{};
    NSDictionary *daemon = self.status[@"daemon"] ?: @{};
    NSStackView *row = [NSStackView stackViewWithViews:@[]];
    row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    row.alignment = NSLayoutAttributeCenterY;
    NSSwitch *toggle = [[NSSwitch alloc] init];
    toggle.state = [config[@"syncEnabled"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
    toggle.target = self;
    toggle.action = @selector(syncToggleChanged:);
    [row addArrangedSubview:Label(L(english, @"实时同步", @"Live sync"), 12, NSFontWeightMedium, nil)];
    [row addArrangedSubview:toggle];
    [row addArrangedSubview:[self spacer]];
    NSButton *scan = [NSButton buttonWithTitle:[daemon[@"syncing"] boolValue] ? L(english, @"正在检查", @"Checking") : L(english, @"立即检查", @"Check now") target:self action:@selector(syncNow:)];
    scan.bezelStyle = NSBezelStyleRounded;
    scan.keyEquivalent = @"";
    [row addArrangedSubview:scan];
    [row.widthAnchor constraintEqualToConstant:354].active = YES;
    return row;
}

- (NSView *)agentsView {
    BOOL english = IsEnglish(self.status);
    NSStackView *stack = [[NSStackView alloc] init];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 7;
    [stack addArrangedSubview:Label(L(english, @"保持连续的 Agent", @"Agents kept continuous"), 10, NSFontWeightSemibold, NSColor.secondaryLabelColor)];
    NSArray *agents = self.status[@"agents"] ?: @[];
    NSArray *order = @[@"codex", @"claude", @"opencode", @"qoder"];
    for (NSString *agentID in order) {
        NSDictionary *agent = nil;
        for (NSDictionary *candidate in agents) if ([candidate[@"id"] isEqualToString:agentID]) { agent = candidate; break; }
        if (!agent) continue;
        NSStackView *row = [NSStackView stackViewWithViews:@[]];
        row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
        row.alignment = NSLayoutAttributeCenterY;
        row.spacing = 9;
        NSTextField *initials = Label(Initials(agentID), 9, NSFontWeightBold, NSColor.secondaryLabelColor);
        initials.alignment = NSTextAlignmentCenter;
        [initials.widthAnchor constraintEqualToConstant:26].active = YES;
        NSStackView *copy = [[NSStackView alloc] init];
        copy.orientation = NSUserInterfaceLayoutOrientationVertical;
        copy.alignment = NSLayoutAttributeLeading;
        copy.spacing = 1;
        [copy addArrangedSubview:Label(agent[@"name"], 11, NSFontWeightMedium, nil)];
        NSDictionary *coverage = agent[@"coverage"] ?: @{};
        NSString *detail = [agent[@"detected"] boolValue]
            ? ([coverage[@"total"] integerValue]
                ? (english ? [NSString stringWithFormat:@"%@/%@ verified", coverage[@"verified"] ?: @0, coverage[@"total"] ?: @0] : [NSString stringWithFormat:@"%@/%@ 条已验证", coverage[@"verified"] ?: @0, coverage[@"total"] ?: @0])
                : L(english, @"已检测 · 尚无连续会话", @"Detected · no continuous sessions"))
            : L(english, @"未检测到现有会话", @"No existing sessions detected");
        [copy addArrangedSubview:Label(detail, 9, NSFontWeightRegular, NSColor.secondaryLabelColor)];
        NSButton *check = [NSButton checkboxWithTitle:@"" target:self action:@selector(agentChanged:)];
        check.state = [agent[@"selected"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
        check.identifier = agentID;
        [row addArrangedSubview:initials];
        [row addArrangedSubview:copy];
        [row addArrangedSubview:[self spacer]];
        [row addArrangedSubview:check];
        [row.widthAnchor constraintEqualToConstant:354].active = YES;
        [stack addArrangedSubview:row];
    }
    return stack;
}

- (NSView *)sessionsView:(NSArray *)sessions {
    BOOL english = IsEnglish(self.status);
    NSStackView *stack = [[NSStackView alloc] init];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 6;
    [stack addArrangedSubview:Label(L(english, @"最近连续会话", @"Recent continuous sessions"), 10, NSFontWeightSemibold, NSColor.secondaryLabelColor)];
    NSUInteger count = MIN((NSUInteger)3, sessions.count);
    for (NSUInteger index = 0; index < count; index++) {
        NSDictionary *session = sessions[index];
        NSArray *targets = session[@"targets"] ?: @[];
        BOOL healthy = YES;
        NSMutableArray *names = [NSMutableArray array];
        for (NSDictionary *target in targets) {
            [names addObject:Initials(target[@"agent"])];
            NSString *state = target[@"state"];
            if (![@[@"source", @"verified"] containsObject:state]) healthy = NO;
        }
        NSStackView *row = [NSStackView stackViewWithViews:@[]];
        row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
        [row addArrangedSubview:Label(session[@"title"], 10, NSFontWeightRegular, nil)];
        [row addArrangedSubview:[self spacer]];
        [row addArrangedSubview:Label([names componentsJoinedByString:@" · "], 9, NSFontWeightRegular, NSColor.secondaryLabelColor)];
        [row addArrangedSubview:Label(@"●", 9, NSFontWeightRegular, healthy ? NSColor.systemGreenColor : NSColor.systemOrangeColor)];
        [row.widthAnchor constraintEqualToConstant:354].active = YES;
        [stack addArrangedSubview:row];
    }
    return stack;
}

- (NSView *)offlineView {
    BOOL english = IsEnglish(self.status);
    NSStackView *stack = [[NSStackView alloc] init];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 8;
    [stack addArrangedSubview:Label(L(english, @"本地同步服务尚未启动", @"The local sync service is not running"), 14, NSFontWeightSemibold, NSColor.systemOrangeColor)];
    [stack addArrangedSubview:Label(L(english, @"安装程序会同时注册后台服务和菜单栏入口。", @"The installer registers both the background service and menu bar app."), 10, NSFontWeightRegular, NSColor.secondaryLabelColor)];
    [stack addArrangedSubview:[NSButton buttonWithTitle:L(english, @"重新连接", @"Reconnect") target:self action:@selector(retry:)]];
    return stack;
}

- (NSView *)footerView {
    BOOL english = IsEnglish(self.status);
    NSStackView *row = [NSStackView stackViewWithViews:@[]];
    row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    NSButton *details = [NSButton buttonWithTitle:L(english, @"打开详细账本…", @"Open detailed ledger…") target:self action:@selector(openDashboard:)];
    details.bezelStyle = NSBezelStyleInline;
    details.contentTintColor = NSColor.controlAccentColor;
    NSButton *language = [NSButton buttonWithTitle:english ? @"中文" : @"English" target:self action:@selector(toggleLanguage:)];
    language.bezelStyle = NSBezelStyleInline;
    NSButton *quit = [NSButton buttonWithTitle:L(english, @"退出", @"Quit") target:self action:@selector(quit:)];
    quit.bezelStyle = NSBezelStyleInline;
    [row addArrangedSubview:details];
    [row addArrangedSubview:[self spacer]];
    [row addArrangedSubview:language];
    [row addArrangedSubview:quit];
    [row.widthAnchor constraintEqualToConstant:354].active = YES;
    return row;
}

- (NSView *)spacer {
    NSView *view = [[NSView alloc] init];
    [view setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    [view setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    return view;
}

- (void)refresh {
    [self request:@"/api/status" method:@"GET" body:nil completion:^(NSDictionary *json, NSError *error) {
        self.status = error ? nil : json;
        BOOL english = IsEnglish(self.status);
        NSString *offline = L(english, @"无法连接本地同步服务", @"Cannot connect to the local sync service");
        if (error && !self.notice.length) self.notice = offline;
        if (!error && ([self.notice isEqualToString:@"无法连接本地同步服务"] || [self.notice isEqualToString:@"Cannot connect to the local sync service"])) self.notice = nil;
        [self render];
    }];
}

- (void)patchConfig:(NSDictionary *)patch {
    [self request:@"/api/config" method:@"PUT" body:patch completion:^(__unused NSDictionary *json, NSError *error) {
        self.notice = error ? LocalizedErrorMessage(error, IsEnglish(self.status)) : nil;
        [self refresh];
    }];
}

- (void)syncToggleChanged:(NSSwitch *)sender { [self patchConfig:@{ @"syncEnabled": @(sender.state == NSControlStateValueOn) }]; }
- (void)agentChanged:(NSButton *)sender { [self patchConfig:@{ @"selectedAgents": @{ sender.identifier ?: @"": @(sender.state == NSControlStateValueOn) } }]; }
- (void)syncNow:(__unused id)sender { [self request:@"/api/sync" method:@"POST" body:@{ @"includeExisting": @NO } completion:^(__unused NSDictionary *json, NSError *error) { BOOL english = IsEnglish(self.status); self.notice = error ? LocalizedErrorMessage(error, english) : L(english, @"检查完成", @"Check complete"); [self refresh]; }]; }
- (void)toggleLanguage:(__unused id)sender { [self patchConfig:@{ @"language": IsEnglish(self.status) ? @"zh-CN" : @"en" }]; }
- (void)retry:(__unused id)sender { self.notice = nil; [self refresh]; }
- (void)openDashboard:(__unused id)sender { [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:[NSString stringWithFormat:@"http://%@:%ld", ASBBaseHost, (long)self.port]]]; }
- (void)quit:(__unused id)sender { [NSApp terminate:nil]; }

- (void)request:(NSString *)path method:(NSString *)method body:(NSDictionary *)body completion:(void (^)(NSDictionary *, NSError *))completion {
    NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://%@:%ld%@", ASBBaseHost, (long)self.port, path]];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:15];
    request.HTTPMethod = method;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    if (body) request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    [[[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSDictionary *json = nil;
        if (!error && data.length) json = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
        NSInteger statusCode = [(NSHTTPURLResponse *)response statusCode];
        if (!error && (statusCode < 200 || statusCode >= 300)) {
            NSString *message = [json[@"error"] isKindOfClass:NSString.class] ? json[@"error"] : L(IsEnglish(self.status), @"本地服务返回了异常状态", @"The local service returned an unexpected status");
            error = [NSError errorWithDomain:@"Agentail" code:statusCode userInfo:@{ NSLocalizedDescriptionKey: message }];
        }
        dispatch_async(dispatch_get_main_queue(), ^{ completion(json, error); });
    }] resume];
}

@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    id portValue = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"ASBPort"];
    NSInteger port = portValue ? [portValue integerValue] : 4765;
    self.panel = [[BridgePanelController alloc] initWithPort:port];
    self.popover = [[NSPopover alloc] init];
    self.popover.behavior = NSPopoverBehaviorTransient;
    self.popover.contentViewController = self.panel;
    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength];
    NSStatusBarButton *button = self.statusItem.button;
    NSImage *bridgeIcon = [NSImage imageWithSystemSymbolName:@"point.3.connected.trianglepath.dotted" accessibilityDescription:@"Agentail"];
    button.image = bridgeIcon;
    NSImage *applicationIcon = [bridgeIcon copy];
    applicationIcon.size = NSMakeSize(128, 128);
    NSApp.applicationIconImage = applicationIcon;
    button.target = self;
    button.action = @selector(togglePopover:);

    if ([[[NSProcessInfo processInfo] environment][@"ASB_DEBUG_WINDOW"] boolValue]) {
        BridgePanelController *debugPanel = [[BridgePanelController alloc] initWithPort:port];
        NSWindow *debugWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 390, 468)
                                                             styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable)
                                                               backing:NSBackingStoreBuffered
                                                                 defer:NO];
        debugWindow.title = @"Agentail — Any agent. Same trail.";
        debugWindow.contentViewController = debugPanel;
        debugWindow.releasedWhenClosed = NO;
        self.debugWindow = debugWindow;
        [debugWindow center];
        [NSApp activateIgnoringOtherApps:YES];
        [debugWindow makeKeyAndOrderFront:nil];
    }

    NSString *welcomeKey = @"hasShownAgentailWelcomeV1";
    if (![[NSUserDefaults standardUserDefaults] boolForKey:welcomeKey]) {
        [[NSUserDefaults standardUserDefaults] setBool:YES forKey:welcomeKey];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.4 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self showWelcome];
        });
    }
}

- (void)showWelcome {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 450, 310)
                                                   styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable)
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.title = @"Agentail";
    window.releasedWhenClosed = NO;
    NSStackView *stack = [[NSStackView alloc] init];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeCenterX;
    stack.spacing = 16;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    NSImageView *icon = [[NSImageView alloc] init];
    icon.image = [NSImage imageWithSystemSymbolName:@"point.3.connected.trianglepath.dotted" accessibilityDescription:@"Agentail"];
    icon.contentTintColor = NSColor.controlAccentColor;
    [icon.widthAnchor constraintEqualToConstant:52].active = YES;
    [icon.heightAnchor constraintEqualToConstant:52].active = YES;
    NSTextField *title = Label(@"Agentail", 22, NSFontWeightBold, nil);
    NSTextField *slogan = Label(@"Any agent. Same trail.\nAgent 随心换，上下文不断。", 13, NSFontWeightSemibold, NSColor.controlAccentColor);
    slogan.maximumNumberOfLines = 2;
    slogan.lineBreakMode = NSLineBreakByWordWrapping;
    slogan.alignment = NSTextAlignmentCenter;
    NSTextField *detail = Label(@"点击屏幕顶部的 Agentail 图标即可查看连续性、切换中英文并同步会话。\nUse the Agentail menu bar icon to switch languages and keep sessions in sync.", 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
    detail.maximumNumberOfLines = 4;
    detail.lineBreakMode = NSLineBreakByWordWrapping;
    detail.alignment = NSTextAlignmentCenter;
    [detail.widthAnchor constraintEqualToConstant:340].active = YES;
    NSButton *done = [NSButton buttonWithTitle:@"开始 / Get started" target:self action:@selector(dismissWelcome:)];
    done.keyEquivalent = @"\r";
    done.bezelStyle = NSBezelStyleRounded;
    [stack addArrangedSubview:icon];
    [stack addArrangedSubview:title];
    [stack addArrangedSubview:slogan];
    [stack addArrangedSubview:detail];
    [stack addArrangedSubview:done];
    [window.contentView addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
        [stack.centerXAnchor constraintEqualToAnchor:window.contentView.centerXAnchor],
        [stack.centerYAnchor constraintEqualToAnchor:window.contentView.centerYAnchor],
    ]];
    self.welcomeWindow = window;
    [window center];
    [NSApp activateIgnoringOtherApps:YES];
    [window makeKeyAndOrderFront:nil];
}

- (void)dismissWelcome:(id)sender {
    [self.welcomeWindow close];
    self.welcomeWindow = nil;
    [self showPopover];
}

- (void)showPopover {
    [self.panel refresh];
    [self.popover showRelativeToRect:self.statusItem.button.bounds ofView:self.statusItem.button preferredEdge:NSRectEdgeMinY];
}

- (void)togglePopover:(id)sender {
    if (self.popover.shown) {
        [self.popover performClose:sender];
    } else {
        [self showPopover];
    }
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [application run];
    }
    return 0;
}
