import AppKit
import CoreGraphics

// Observe OS activation events and on-screen window owners without activating any app.
var activatedPids = Set<Int32>()
var visibleWindowPids = Set<Int32>()
var sampleCount = 0
let workspace = NSWorkspace.shared
let observer = workspace.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
) { notification in
    if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
        activatedPids.insert(app.processIdentifier)
    }
}

func sampleWindows() {
    if let app = workspace.frontmostApplication {
        activatedPids.insert(app.processIdentifier)
    }
    guard let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] else { return }
    sampleCount += 1
    for window in windows {
        if let pid = window[kCGWindowOwnerPID as String] as? Int32 {
            visibleWindowPids.insert(pid)
        }
    }
}

sampleWindows()
let timer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { _ in sampleWindows() }
print("READY")
fflush(stdout)

DispatchQueue.global().async {
    _ = readLine()
    DispatchQueue.main.async {
        sampleWindows()
        timer.invalidate()
        workspace.notificationCenter.removeObserver(observer)
        let result: [String: Any] = [
            "activatedPids": activatedPids.sorted(),
            "visibleWindowPids": visibleWindowPids.sorted(),
            "sampleCount": sampleCount,
        ]
        let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        fflush(stdout)
        exit(0)
    }
}
RunLoop.main.run()
