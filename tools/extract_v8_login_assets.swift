// Editor-time extraction. Preserve approved artwork pixels inside contour masks.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let args = CommandLine.arguments
guard args.count == 4 else { fatalError("usage: reference.png continuous-background-source.png output-directory") }
typealias Rect = (Int, Int, Int, Int)
let w = 941, h = 1672, padding = 280
let output = URL(fileURLWithPath: args[3])
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
func read(_ path: String, _ width: Int, _ height: Int) -> [UInt8] {
    let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil)!
    let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
    var data = [UInt8](repeating: 0, count: width * height * 4)
    let ctx = CGContext(data: &data, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: width, height: height))
    return data
}
func write(_ data: [UInt8], _ width: Int, _ height: Int, _ name: String) {
    var copy = data
    let ctx = CGContext(data: &copy, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let dest = CGImageDestinationCreateWithURL(output.appendingPathComponent(name) as CFURL,
        UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    precondition(CGImageDestinationFinalize(dest))
}
let source = read(args[1], w, h)
let shield: Rect = (260, 200, 677, 714)
let account: Rect = (137, 750, 800, 897)
let password: Rect = (137, 916, 800, 1064)
let button: Rect = (137, 1212, 800, 1342)
let reset: Rect = (154, 1098, 316, 1158)
let register: Rect = (614, 1098, 789, 1158)
let hintAccount: Rect = (299, 798, 487, 858)
let hintPassword: Rect = (299, 964, 487, 1024)
func saveCrop(_ r: Rect, _ name: String, from pixels: [UInt8]? = nil, contour: CGPath? = nil, lettering: Bool = false) {
    let src = pixels ?? source
    var result = [UInt8]()
    for y in r.1..<r.3 { result.append(contentsOf: src[(y*w+r.0)*4..<(y*w+r.2)*4]) }
    let cw=r.2-r.0, ch=r.3-r.1
    if let contour = contour {
        var mask=[UInt8](repeating:0,count:cw*ch)
        let ctx=CGContext(data:&mask,width:cw,height:ch,bitsPerComponent:8,bytesPerRow:cw,
            space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)!
        ctx.translateBy(x:0,y:CGFloat(ch)); ctx.scaleBy(x:1,y:-1)
        ctx.setFillColor(gray:1,alpha:1); ctx.addPath(contour); ctx.fillPath()
        for i in 0..<(cw*ch) { for k in 0..<4 { result[i*4+k]=UInt8(Int(result[i*4+k])*Int(mask[i])/255) } }
    }
    if lettering {
        // Keep pale/white highlights as well as gold; retain a narrow shadow edge.
        var mask=[Bool](repeating:false,count:cw*ch)
        for i in 0..<(cw*ch) {
            let r=Int(result[i*4]),g=Int(result[i*4+1]),b=Int(result[i*4+2])
            mask[i]=(min(r,g)>b+4)||(min(r,min(g,b))>170)
        }
        for y in 0..<ch { for x in 0..<cw {
            var keep=false
            for yy in max(0,y-1)...min(ch-1,y+1) { for xx in max(0,x-1)...min(cw-1,x+1) { keep = keep || mask[yy*cw+xx] } }
            if !keep { for k in 0..<4 { result[(y*cw+x)*4+k]=0 } }
        }}
    }
    write(result,cw,ch,name)
}
// Empty EditBox surface interpolates its clean boundary, with no color-keyed
// text remnants. The full original placeholder crop overlays it when idle.
var clean = source
for r in [hintAccount, hintPassword] {
    func c(_ x: Int, _ y: Int, _ k: Int) -> Double { Double(source[(y*w+x)*4+k]) }
    for y in r.1..<r.3 { for x in r.0..<r.2 {
        let u = Double(x-r.0)/Double(r.2-r.0-1), v = Double(y-r.1)/Double(r.3-r.1-1)
        for k in 0..<3 {
            let a = (1-v)*c(x,r.1,k)+v*c(x,r.3-1,k)
            let b = (1-u)*c(r.0,y,k)+u*c(r.2-1,y,k)
            let corners = (1-u)*(1-v)*c(r.0,r.1,k)+u*(1-v)*c(r.2-1,r.1,k)
                + (1-u)*v*c(r.0,r.3-1,k)+u*v*c(r.2-1,r.3-1,k)
            clean[(y*w+x)*4+k] = UInt8(max(0,min(255,(a+b-corners).rounded())))
        }
    }}
}
let shieldPath=CGMutablePath()
shieldPath.move(to:CGPoint(x:211,y:6))
shieldPath.addCurve(to:CGPoint(x:345,y:61),control1:CGPoint(x:244,y:34),control2:CGPoint(x:295,y:49))
shieldPath.addCurve(to:CGPoint(x:407,y:140),control1:CGPoint(x:352,y:105),control2:CGPoint(x:379,y:129))
shieldPath.addLine(to:CGPoint(x:382,y:274)); shieldPath.addLine(to:CGPoint(x:398,y:261))
shieldPath.addCurve(to:CGPoint(x:353,y:409),control1:CGPoint(x:383,y:305),control2:CGPoint(x:381,y:365))
shieldPath.addCurve(to:CGPoint(x:211,y:509),control1:CGPoint(x:333,y:437),control2:CGPoint(x:284,y:466))
shieldPath.addCurve(to:CGPoint(x:76,y:416),control1:CGPoint(x:143,y:466),control2:CGPoint(x:99,y:445))
shieldPath.addCurve(to:CGPoint(x:17,y:261),control1:CGPoint(x:52,y:389),control2:CGPoint(x:43,y:335))
shieldPath.addLine(to:CGPoint(x:35,y:274)); shieldPath.addLine(to:CGPoint(x:8,y:140))
shieldPath.addCurve(to:CGPoint(x:73,y:61),control1:CGPoint(x:48,y:121),control2:CGPoint(x:64,y:101))
shieldPath.addCurve(to:CGPoint(x:211,y:6),control1:CGPoint(x:131,y:50),control2:CGPoint(x:178,y:29))
shieldPath.closeSubpath()
saveCrop(shield,"login_shield_exact.png",contour:shieldPath)
saveCrop(account,"login_input_account_exact.png",from:clean,contour:CGPath(roundedRect:CGRect(x:1,y:2,width:660,height:143),cornerWidth:29,cornerHeight:29,transform:nil))
saveCrop(password,"login_input_password_exact.png",from:clean,contour:CGPath(roundedRect:CGRect(x:1,y:2,width:660,height:144),cornerWidth:29,cornerHeight:29,transform:nil))
saveCrop(button,"login_button_exact.png",contour:CGPath(roundedRect:CGRect(x:1,y:1,width:660,height:126),cornerWidth:29,cornerHeight:29,transform:nil))
saveCrop(reset,"login_link_reset_exact.png",lettering:true)
saveCrop(register,"login_link_register_exact.png",lettering:true)
saveCrop(hintAccount,"login_hint_account_exact.png")
saveCrop(hintPassword,"login_hint_password_exact.png")
// A single continuous clean image: no source/extension splice or UI-shaped holes.
let background = read(args[2], w, h+padding*2)
write(background,w,h+padding*2,"casino_bg.png")
print("Extracted approved UI contours over one continuous opaque background.")
