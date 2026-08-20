// burn_subtitles.swift — 逐帧渲染字幕（无音频），输出后与配音合并
// 用法: swift burn_subtitles.swift <in.mp4> <meta.json> <out.mp4>
import AVFoundation
import AppKit
import CoreVideo
import Foundation

let args = CommandLine.arguments
guard args.count >= 4 else { print("usage: burn_subtitles.swift <in.mp4> <meta.json> <out.mp4>"); exit(1) }
let inputURL = URL(fileURLWithPath: args[1])
let metaPath = args[2]
let outputURL = URL(fileURLWithPath: args[3])

guard let metaData = try? Data(contentsOf: URL(fileURLWithPath: metaPath)),
      let segments = try? JSONSerialization.jsonObject(with: metaData) as? [[String: Any]] else { print("bad meta"); exit(1) }

let asset = AVAsset(url: inputURL)
let duration = asset.duration
let videoTracks = asset.tracks(withMediaType: .video)
guard let videoTrack = videoTracks.first else { print("no video track"); exit(1) }
let size = videoTrack.naturalSize
let W = Int(size.width), H = Int(size.height)
print("video \(W)x\(H), dur \(CMTimeGetSeconds(duration))s")

struct Sub { let start: Double; let dur: Double; let text: NSAttributedString }
let fontSize: CGFloat = max(44, CGFloat(W) / 30)
let subs: [Sub] = segments.compactMap { seg in
    guard let start = seg["start"] as? Double, let dur = seg["dur"] as? Double,
          let text = seg["text"] as? String, !text.isEmpty else { return nil }
    let para = NSMutableParagraphStyle()
    para.alignment = .center
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.boldSystemFont(ofSize: fontSize),
        .foregroundColor: NSColor.white,
        .paragraphStyle: para
    ]
    return Sub(start: start, dur: dur, text: NSAttributedString(string: text, attributes: attrs))
}
print("subs: \(subs.count)")
func activeSub(at t: Double) -> Sub? {
    for s in subs where t >= s.start && t < s.start + s.dur { return s }
    return nil
}

// Reader
let reader = try AVAssetReader(asset: asset)
let outSettings: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
let trackOut = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: outSettings)
reader.add(trackOut)
reader.startReading()

// Writer
try? FileManager.default.removeItem(at: outputURL)
let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: W,
    AVVideoHeightKey: H
])
videoInput.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: W,
    kCVPixelBufferHeightKey as String: H
])
writer.add(videoInput)
guard writer.startWriting() else { print("startWriting fail"); exit(1) }
writer.startSession(atSourceTime: .zero)

// 渲染上下文
let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { print("ctx fail"); exit(1) }
let barRect = CGRect(x: CGFloat(W) * 0.08, y: CGFloat(H) * 0.06, width: CGFloat(W) * 0.84, height: fontSize * 2.4)
let ciContext = CIContext()

var frameIndex = 0
while true {
    if videoInput.isReadyForMoreMediaData, let sb = trackOut.copyNextSampleBuffer() {
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        let t = CMTimeGetSeconds(pts)
        guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
        let ci = CIImage(cvPixelBuffer: pb)
        guard let cg = ciContext.createCGImage(ci, from: ci.extent) else { continue }
        ctx.clear(CGRect(x: 0, y: 0, width: W, height: H))
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
        if let sub = activeSub(at: t) {
            ctx.setFillColor(NSColor.black.withAlphaComponent(0.55).cgColor)
            let path = CGPath(roundedRect: barRect, cornerWidth: 16, cornerHeight: 16, transform: nil)
            ctx.addPath(path)
            ctx.fillPath()
            // CoreText 直接绘制（不依赖 AppKit context 绑定）
            let line = CTLineCreateWithAttributedString(sub.text)
            let bounds = CTLineGetBoundsWithOptions(line, [.useOpticalBounds])
            let tx = barRect.midX - bounds.width / 2
            let ty = barRect.midY - bounds.height / 2 - bounds.minY
            ctx.textPosition = CGPoint(x: tx, y: ty)
            CTLineDraw(line, ctx)
        }
        var outPB: CVPixelBuffer?
        let poolOK: Bool = {
            guard let pool = adaptor.pixelBufferPool else { return false }
            return CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outPB) == kCVReturnSuccess
        }()
        if poolOK, let ob = outPB {
            CVPixelBufferLockBaseAddress(ob, [])
            memcpy(CVPixelBufferGetBaseAddress(ob), ctx.data!, W * H * 4)
            CVPixelBufferUnlockBaseAddress(ob, [])
            adaptor.append(ob, withPresentationTime: pts)
        }
        frameIndex += 1
        if frameIndex % 600 == 0 { print("frames: \(frameIndex) t=\(String(format: "%.1f", t))s") }
    } else {
        if reader.status == .completed || reader.status == .failed { break }
        usleep(4000)
    }
}
videoInput.markAsFinished()
reader.cancelReading()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
print("done frames=\(frameIndex) status=\(writer.status.rawValue) err=\(writer.error?.localizedDescription ?? "none")")
