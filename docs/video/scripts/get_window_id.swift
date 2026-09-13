// get_window_id.swift — 获取指定应用的窗口 ID（用于 screencapture -l 窗口录制）
// 用法: swift get_window_id.swift "ego lite" [可选: 窗口标题关键字]
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else {
    print("usage: swift get_window_id.swift <app-name> [title-keyword]")
    exit(1)
}
let appName = args[1]
let titleKeyword = args.count >= 3 ? args[2] : nil

guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
    print("cannot get window list")
    exit(1)
}

for win in list {
    guard let owner = win[kCGWindowOwnerName as String] as? String, owner.contains(appName) else { continue }
    let wid = win[kCGWindowNumber as String] as? Int ?? 0
    let name = win[kCGWindowName as String] as? String ?? ""
    let bounds = win[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let w = bounds["Width"] as? Int ?? 0
    let h = bounds["Height"] as? Int ?? 0
    if let kw = titleKeyword, !name.contains(kw) { continue }
    print("WINDOW_ID=\(wid) TITLE=\(name) SIZE=\(w)x\(h) LAYER=\(win[kCGWindowLayer as String] ?? 0)")
}
