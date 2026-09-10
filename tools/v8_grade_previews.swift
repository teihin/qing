import Foundation
import CoreImage
import ImageIO
import CoreGraphics

guard CommandLine.arguments.count == 3 else {
    fputs("usage: v8_grade_previews.swift input.png output.png\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let context = CIContext()

guard let sourceImage = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
      let cgSourceImage = CGImageSourceCreateImageAtIndex(sourceImage, 0, nil) else {
    fputs("cannot read input: \(inputURL.path)\n", stderr)
    exit(3)
}
let source = CIImage(cgImage: cgSourceImage)

let controls = CIFilter(name: "CIColorControls")!
controls.setValue(source, forKey: kCIInputImageKey)
controls.setValue(0.055, forKey: kCIInputBrightnessKey)
controls.setValue(1.08, forKey: kCIInputContrastKey)
controls.setValue(0.965, forKey: kCIInputSaturationKey)

guard let output = controls.outputImage else {
    fputs("filter produced no output\n", stderr)
    exit(4)
}
let rect = CGRect(x: 0, y: 0, width: source.extent.width, height: source.extent.height)
guard let cgImage = context.createCGImage(output, from: rect) else {
    fputs("cannot create CGImage from filtered output\n", stderr)
    exit(4)
}
guard let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, "public.png" as CFString, 1, nil) else {
    fputs("cannot create PNG destination: \(outputURL.path)\n", stderr)
    exit(4)
}

CGImageDestinationAddImage(destination, cgImage, nil)
if !CGImageDestinationFinalize(destination) {
    fputs("failed to finalize output: \(outputURL.path)\n", stderr)
    exit(5)
}
