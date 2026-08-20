// compose_video.swift — 视频 + 配音 + 字幕烧录合成
// 用法: swift compose_video.swift <input.mp4> <meta.json> <tts_dir> <output.mp4>
import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 5 else { print("usage: compose_video.swift <in.mp4> <meta.json> <ttsdir> <out.mp4>"); exit(1) }
let inputURL = URL(fileURLWithPath: args[1])
let metaPath = args[2]
let ttsDir = args[3]
let outputURL = URL(fileURLWithPath: args[4])

guard let metaData = try? Data(contentsOf: URL(fileURLWithPath: metaPath)),
      let segments = try? JSONSerialization.jsonObject(with: metaData) as? [[String: Any]] else {
    print("bad meta"); exit(1)
}

let asset = AVAsset(url: inputURL)
let duration = asset.duration
let videoTracks = asset.tracks(withMediaType: .video)
guard let videoTrack = videoTracks.first else { print("no video"); exit(1) }
let size = videoTrack.naturalSize
print("video: \(Int(size.width))x\(Int(size.height)) dur=\(CMTimeGetSeconds(duration))s")

// ============ 合成 ============
let comp = AVMutableComposition()
let vt = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
try vt.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: videoTrack, at: .zero)

// 音频轨（配音片段）
var audioSegments: [(CMTime, CMTime, AVURLAsset)] = []
if let at = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
    for seg in segments {
        let idx = seg["i"] as? Int ?? 0
        let start = seg["start"] as? Double ?? 0
        let url = URL(fileURLWithPath: "\(ttsDir)/seg_\(String(format: "%02d", idx)).aiff")
        let aAsset = AVURLAsset(url: url)
        guard let aTrack = aAsset.tracks(withMediaType: .audio).first else { print("no audio in \(url)"); continue }
        let aDur = aTrack.timeRange.duration
        let atTime = CMTime(seconds: start, preferredTimescale: 600)
        try? at.insertTimeRange(CMTimeRange(start: .zero, duration: aDur), of: aTrack, at: atTime)
        audioSegments.append((atTime, aDur, aAsset))
        print("audio seg \(idx) at \(start)s dur=\(CMTimeGetSeconds(aDur))s")
    }
}

// ============ 视频合成指令（含字幕烧录） ============
let videoComp = AVMutableVideoComposition(propertiesOf: asset)
videoComp.renderSize = size

// 字幕层
let W = size.width, H = size.height
let parentLayer = CALayer()
parentLayer.frame = CGRect(x: 0, y: 0, width: W, height: H)
let videoLayer = CALayer()
videoLayer.frame = parentLayer.frame
parentLayer.addSublayer(videoLayer)

let fontSize = max(40, W / 34)
for seg in segments {
    let idx = seg["i"] as? Int ?? 0
    let start = seg["start"] as? Double ?? 0
    let dur = seg["dur"] as? Double ?? 2
    let text = seg["text"] as? String ?? ""
    guard !text.isEmpty else { continue }

    // 半透明背景条
    let bg = CALayer()
    bg.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
    bg.cornerRadius = 12
    bg.frame = CGRect(x: W * 0.12, y: H * 0.075, width: W * 0.76, height: fontSize * 1.9)
    parentLayer.addSublayer(bg)

    let tl = CATextLayer()
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.boldSystemFont(ofSize: fontSize),
        .foregroundColor: NSColor.white
    ]
    let para = NSMutableParagraphStyle()
    para.alignment = .center
    var a2 = attrs
    a2[.paragraphStyle] = para
    tl.string = NSAttributedString(string: text, attributes: a2)
    tl.contentsScale = 2.0
    tl.frame = CGRect(x: W * 0.12, y: H * 0.075, width: W * 0.76, height: fontSize * 1.9)
    parentLayer.addSublayer(tl)

    // 淡入淡出（Apple 官方模式）
    tl.opacity = 0
    bg.opacity = 0
    let fadeIn = CABasicAnimation(keyPath: "opacity")
    fadeIn.fromValue = 0; fadeIn.toValue = 1
    fadeIn.beginTime = AVCoreAnimationBeginTimeAtZero + start
    fadeIn.duration = 0.25
    fadeIn.fillMode = .forwards
    fadeIn.isRemovedOnCompletion = false
    let fadeOut = CABasicAnimation(keyPath: "opacity")
    fadeOut.fromValue = 1; fadeOut.toValue = 0
    fadeOut.beginTime = AVCoreAnimationBeginTimeAtZero + start + dur - 0.25
    fadeOut.duration = 0.25
    fadeOut.fillMode = .forwards
    fadeOut.isRemovedOnCompletion = false
    tl.add(fadeIn, forKey: "in"); tl.add(fadeOut, forKey: "out")
    bg.add(fadeIn, forKey: "in"); bg.add(fadeOut, forKey: "out")
}

videoComp.animationTool = AVVideoCompositionCoreAnimationTool(
    postProcessingAsVideoLayer: videoLayer,
    in: parentLayer
)

// ============ 导出 ============
try? FileManager.default.removeItem(at: outputURL)
guard let session = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else {
    print("export session fail"); exit(1)
}
session.outputURL = outputURL
session.outputFileType = .mp4
session.videoComposition = videoComp
let sem = DispatchSemaphore(value: 0)
session.exportAsynchronously {
    print("export status: \(session.status.rawValue) err=\(session.error?.localizedDescription ?? "none")")
    sem.signal()
}
sem.wait()
if let out = try? FileManager.default.attributesOfItem(atPath: outputURL.path) {
    print("output size: \((out[.size] as? Int ?? 0) / 1024 / 1024) MB")
}
