// Deterministic editor-time extraction of approved pixels and live-value holes.
// JSON manifests use coordinates from the actual V8-new image, never V7 crops.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

typealias Box = [Int]
struct Cut: Decodable {
    let source: String
    let output: String
    let box: Box
    var clear: [Box]?
    var horizontalClear: [Box]?
    var stripClear: [Box]?
    var bandClear: [Box]?
    var radius: Double?
    var polygon: [[Double]]?
    var holes: [Box]?
    var tiledStrip: Box?
    var sideField: Bool?
    var foreground: String?
    var ink: [Int]?
    var inkBounds: Box?
    var glyphOverlay: Box?
}
let manifest = CommandLine.arguments[1]
let cuts = try JSONDecoder().decode([Cut].self, from: Data(contentsOf: URL(fileURLWithPath: manifest)))
for cut in cuts {
    let src = CGImageSourceCreateWithURL(URL(fileURLWithPath:cut.source) as CFURL,nil)!
    let img = CGImageSourceCreateImageAtIndex(src,0,nil)!
    let sw=img.width, sh=img.height, b=cut.box, w=b[2]-b[0], h=b[3]-b[1]
    precondition(b[0]>=0 && b[1]>=0 && b[2]<=sw && b[3]<=sh && w>0 && h>0)
    var pixels=[UInt8](repeating:0,count:sw*sh*4)
    let ctx=CGContext(data:&pixels,width:sw,height:sh,bitsPerComponent:8,bytesPerRow:sw*4,
        space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img,in:CGRect(x:0,y:0,width:sw,height:sh))
    let original=pixels
    func c(_ x:Int,_ y:Int,_ k:Int)->Double { Double(original[(y*sw+x)*4+k]) }
    for r in cut.clear ?? [] {
        for y in r[1]..<r[3] { for x in r[0]..<r[2] { for k in 0..<3 {
            let u=Double(x-r[0])/Double(r[2]-r[0]-1), v=Double(y-r[1])/Double(r[3]-r[1]-1)
            let vertical=(1-v)*c(x,r[1],k)+v*c(x,r[3]-1,k)
            let horizontal=(1-u)*c(r[0],y,k)+u*c(r[2]-1,y,k)
            let upperCorners=(1-u)*(1-v)*c(r[0],r[1],k)+u*(1-v)*c(r[2]-1,r[1],k)
            let lowerCorners=(1-u)*v*c(r[0],r[3]-1,k)+u*v*c(r[2]-1,r[3]-1,k)
            let corners=upperCorners+lowerCorners
            pixels[(y*sw+x)*4+k]=UInt8(max(0,min(255,(vertical+horizontal-corners).rounded())))
        }}}
    }
    for r in cut.horizontalClear ?? [] {
        for y in r[1]..<r[3] { for x in r[0]..<r[2] {for k in 0..<3 {
            let u=Double(x-r[0])/Double(r[2]-r[0]-1)
            pixels[(y*sw+x)*4+k]=UInt8(((1-u)*c(r[0],y,k)+u*c(r[2]-1,y,k)).rounded())
        }}}
    }
    for r in cut.stripClear ?? [] {
        for y in r[1]..<r[3] {for x in r[0]..<r[2] {for k in 0..<3 {
            var total=0.0
            for sampleX in r[4]..<r[5] {total += c(sampleX,y,k)}
            pixels[(y*sw+x)*4+k]=UInt8((total/Double(r[5]-r[4])).rounded())
        }}}
    }
    for r in cut.bandClear ?? [] {
        for x in r[0]..<r[2] {for k in 0..<3 {
            var total=0.0
            for sy in r[4]..<r[5] {total += c(x,sy,k)}
            let value=UInt8((total/Double(r[5]-r[4])).rounded())
            for y in r[1]..<r[3] {pixels[(y*sw+x)*4+k]=value}
        }}
    }
    var output=[UInt8]()
    for y in b[1]..<b[3] { output.append(contentsOf:pixels[(y*sw+b[0])*4..<(y*sw+b[2])*4]) }
    func glyphAlpha(_ r:Int,_ g:Int,_ blue:Int,_ kind:String)->Double {
        if kind=="dark" {return max(0,min(1,Double(155-r)/85))}
        if kind=="cyan" {return max(0,min(1,Double(g-r-45)/95))}
        return max(0,min(1,Double(r-blue*3/4-25)/100))
    }
    if let kind=cut.foreground {
        let bounds=cut.inkBounds ?? [0,0,w,h]
        for y in 0..<h {for x in 0..<w {
            let i=(y*w+x)*4
            var a=glyphAlpha(Int(output[i]),Int(output[i+1]),Int(output[i+2]),kind)
            if x<bounds[0] || y<bounds[1] || x>=bounds[2] || y>=bounds[3] {a=0}
            for k in 0..<3 {output[i+k]=UInt8((Double(cut.ink?[k] ?? Int(output[i+k]))*a).rounded())}
            output[i+3]=UInt8((255*a).rounded())
        }}
    }
    if let glyph=cut.glyphOverlay {
        let gw=glyph[2]-glyph[0], gh=glyph[3]-glyph[1], dx=(w-gw)/2, dy=(h-gh)/2
        for y in 0..<gh {for x in 0..<gw {
            let i=((y+dy)*w+x+dx)*4, si=((y+glyph[1])*sw+x+glyph[0])*4
            let a=glyphAlpha(Int(original[si]),Int(original[si+1]),Int(original[si+2]),"gold")
            for k in 0..<3 {output[i+k]=UInt8((Double(cut.ink?[k] ?? 15)*a+Double(output[i+k])*(1-a)).rounded())}
        }}
    }
    if let strip=cut.tiledStrip {
        // Use an unobscured background strip only for a stretchable list field.
        for y in 0..<h { for x in 0..<w { for k in 0..<4 {
            let sx=strip[0]+x%(strip[2]-strip[0]), sy=strip[1]+y%(strip[3]-strip[1])
            output[(y*w+x)*4+k]=original[(sy*sw+sx)*4+k]
        }}}
    }
    if cut.sideField == true {
        // A continuous blue field from both unobscured margins; no repeated
        // strips, mirrored scenery, baked rows, or sharp patch boundaries.
        for y in 0..<h {
            var left=[Double](repeating:0,count:3), right=left;var count=0.0
            for sy in max(b[1],b[1]+y-24)..<min(b[3],b[1]+y+25) {
                for sx in 0..<16 {for k in 0..<3 {left[k]+=c(sx,sy,k);right[k]+=c(sw-1-sx,sy,k)};count+=1}
            }
            for x in 0..<w {let u=Double(x)/Double(w-1)
                for k in 0..<3 {output[(y*w+x)*4+k]=UInt8(((left[k]*(1-u)+right[k]*u)/count).rounded())}
            }
        }
    }
    if cut.radius != nil || cut.polygon != nil || cut.holes != nil {
        var mask=[UInt8](repeating:0,count:w*h)
        let m=CGContext(data:&mask,width:w,height:h,bitsPerComponent:8,bytesPerRow:w,
            space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)!
        m.translateBy(x:0,y:CGFloat(h));m.scaleBy(x:1,y:-1);m.setFillColor(gray:1,alpha:1)
        if let points=cut.polygon {
            m.move(to:CGPoint(x:points[0][0],y:points[0][1]))
            for p in points.dropFirst() {m.addLine(to:CGPoint(x:p[0],y:p[1]))};m.closePath();m.fillPath()
        } else if let radius=cut.radius {
            m.addPath(CGPath(roundedRect:CGRect(x:0,y:0,width:w,height:h),cornerWidth:radius,cornerHeight:radius,transform:nil));m.fillPath()
        } else {m.fill(CGRect(x:0,y:0,width:w,height:h))}
        m.setFillColor(gray:0,alpha:1)
        for hole in cut.holes ?? [] {m.fillEllipse(in:CGRect(x:hole[0]-b[0],y:hole[1]-b[1],width:hole[2]-hole[0],height:hole[3]-hole[1]))}
        for i in 0..<(w*h) {for k in 0..<4 {output[i*4+k]=UInt8(Int(output[i*4+k])*Int(mask[i])/255)}}
    }
    let out=URL(fileURLWithPath:cut.output)
    try FileManager.default.createDirectory(at:out.deletingLastPathComponent(),withIntermediateDirectories:true)
    let dst=CGImageDestinationCreateWithURL(out as CFURL,UTType.png.identifier as CFString,1,nil)!
    let oc=CGContext(data:&output,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,
        space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
    CGImageDestinationAddImage(dst,oc.makeImage()!,nil);precondition(CGImageDestinationFinalize(dst))
    print(cut.output)
}
