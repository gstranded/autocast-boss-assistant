// frames_to_mp4.swift — 把 PNG 帧序列合成 MP4（H.264）
// 用法: swift frames_to_mp4.swift <output.mp4> <fps> <frame_dir> [frame_prefix] [frame_count]
// 例: swift frames_to_mp4.swift /tmp/demo.mp4 4 /tmp/frames frame_ 1200
import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 5, let fps = Double(args[2]) else {
    print("usage: swift frames_to_mp4.swift <out.mp4> <fps> <dir> <prefix> [count]")
    exit(1)
}
let outPath = args[1]
let dir = args[3]
let prefix = args[4]
let count = args.count >= 6 ? Int(args[5]) ?? Int.max : Int.max

// 收集帧文件
let fm = FileManager.default
guard let files = try? fm.contentsOfDirectory(atPath: dir) else {
    print("cannot read dir \(dir)")
    exit(1)
}
let frames = files
    .filter { $0.hasPrefix(prefix) && $0.hasSuffix(".png") }
    .sorted()
    .prefix(count)
let framePaths = frames.map { (dir as NSString).appendingPathComponent($0) }
print("frames: \(framePaths.count)")
guard let first = framePaths.first, let img = NSImage(contentsOfFile: first) else {
    print("cannot load first frame")
    exit(1)
}
let size = img.size
print("size: \(size.width)x\(size.height)")

// AVAssetWriter
try? fm.removeItem(atPath: outPath)
let writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: outPath), fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: Int(size.width),
    AVVideoHeightKey: Int(size.height)
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: Int(size.width),
        kCVPixelBufferHeightKey as String: Int(size.height)
    ]
)
writer.add(input)
guard writer.startWriting() else { print("startWriting failed: \(writer.error?.localizedDescription ?? "?")"); exit(1) }
writer.startSession(atSourceTime: .zero)

let frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
var frameCount = 0
for path in framePaths {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("skip bad frame: \(path)")
        continue
    }
    guard let pool = adaptor.pixelBufferPool else {
        print("no pixel buffer pool")
        break
    }
    var pixelBuffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
    guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
        print("pixel buffer create failed")
        break
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    if let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: Int(size.width), height: Int(size.height),
        bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
    ) {
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    let time = CMTime(value: CMTimeValue(frameCount), timescale: CMTimeScale(fps))
    while !input.isReadyForMoreMediaData { usleep(2000) }
    if adaptor.append(buffer, withPresentationTime: time) {
        frameCount += 1
    }
}
input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
print("wrote \(frameCount) frames -> \(outPath) status=\(writer.status.rawValue) err=\(writer.error?.localizedDescription ?? "none")")
