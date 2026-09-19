import assert from "node:assert/strict";
import test from "node:test";
import { MENU_APP_LABEL, menuAppLaunchAgentPlist } from "../src/macos-app.mjs";
import { launchAgentPlist, SERVICE_LABEL } from "../src/service.mjs";

test("launchd plist escapes paths and binds the service to localhost", () => {
  const plist = launchAgentPlist({
    node: "/Applications/Node & Tools/node",
    cli: "/tmp/agent-session-bridge.mjs",
    stateRoot: "/tmp/state",
    port: 4999,
  });
  assert.match(plist, new RegExp(SERVICE_LABEL));
  assert.match(plist, /127\.0\.0\.1/);
  assert.match(plist, /4999/);
  assert.match(plist, /Node &amp; Tools/);
  assert.match(plist, /RunAtLoad/);
  assert.match(plist, /KeepAlive/);
});

test("menu app launchd plist escapes its executable path and runs at login", () => {
  const plist = menuAppLaunchAgentPlist({
    executable: "/Users/example/Applications/Agentail & Tools.app/Contents/MacOS/Agentail",
  });
  assert.match(plist, new RegExp(MENU_APP_LABEL));
  assert.match(plist, /Agentail &amp; Tools/);
  assert.match(plist, /RunAtLoad/);
  assert.match(plist, /ProcessType/);
  assert.doesNotMatch(plist, /KeepAlive/);
});
