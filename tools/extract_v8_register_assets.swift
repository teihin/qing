// Editor-time V8 register extraction: no repainting of approved static art.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args=CommandLine.arguments
guard args.count==3 else { fatalError("usage: approved-register.png output-directory") }
let width=941, height=1672
typealias Box=(Int,Int,Int,Int)
let output=URL(fileURLWithPath:args[2])
try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
let imageSource=CGImageSourceCreateWithURL(URL(fileURLWithPath:args[1]) as CFURL,nil)!
let image=CGImageSourceCreateImageAtIndex(imageSource,0,nil)!
precondition(image.width==width && image.height==height)
var source=[UInt8](repeating:0,count:width*height*4)
let sourceContext=CGContext(data:&source,width:width,height:height,bitsPerComponent:8,
    bytesPerRow:width*4,space:CGColorSpaceCreateDeviceRGB(),
    bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
sourceContext.draw(image,in:CGRect(x:0,y:0,width:width,height:height))

func crop(_ box:Box,from pixels:[UInt8]?=nil)->[UInt8] {
    let input=pixels ?? source
    var result=[UInt8]()
    for y in box.1..<box.3 { result.append(contentsOf:input[(y*width+box.0)*4..<(y*width+box.2)*4]) }
    return result
}
func save(_ pixels:[UInt8],_ w:Int,_ h:Int,_ name:String) {
    var data=pixels
    let ctx=CGContext(data:&data,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,
        space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
    let destination=CGImageDestinationCreateWithURL(output.appendingPathComponent(name) as CFURL,
        UTType.png.identifier as CFString,1,nil)!
    CGImageDestinationAddImage(destination,ctx.makeImage()!,nil)
    precondition(CGImageDestinationFinalize(destination))
}
func saveCrop(_ box:Box,_ name:String,from pixels:[UInt8]?=nil) {
    save(crop(box,from:pixels),box.2-box.0,box.3-box.1,name)
}
func applyMask(_ pixels:inout[UInt8],_ w:Int,_ h:Int,_ paint:(CGContext)->Void) {
    var mask=[UInt8](repeating:0,count:w*h)
    let ctx=CGContext(data:&mask,width:w,height:h,bitsPerComponent:8,bytesPerRow:w,
        space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)!
    ctx.translateBy(x:0,y:CGFloat(h));ctx.scaleBy(x:1,y:-1)
    paint(ctx)
    for i in 0..<(w*h) { for k in 0..<4 { pixels[i*4+k]=UInt8(Int(pixels[i*4+k])*Int(mask[i])/255) } }
}
func clearLiveRegion(_ box:Box,from pixels:inout[UInt8]) {
    // Only variable text areas are cleared; source borders/icons/labels stay exact.
    func c(_ x:Int,_ y:Int,_ k:Int)->Double { Double(source[(y*width+x)*4+k]) }
    for y in box.1..<box.3 { for x in box.0..<box.2 {
        let u=Double(x-box.0)/Double(box.2-box.0-1),v=Double(y-box.1)/Double(box.3-box.1-1)
        for k in 0..<3 {
            let vertical=(1-v)*c(x,box.1,k)+v*c(x,box.3-1,k)
            let horizontal=(1-u)*c(box.0,y,k)+u*c(box.2-1,y,k)
            let corners=((1-u)*(1-v)*c(box.0,box.1,k)+u*(1-v)*c(box.2-1,box.1,k)
                + (1-u)*v*c(box.0,box.3-1,k)+u*v*c(box.2-1,box.3-1,k))
            pixels[(y*width+x)*4+k]=UInt8(max(0,min(255,(vertical+horizontal-corners).rounded())))
        }
    }}
}

// The entire approved modal stays at source resolution, with only its outside
// corners and live avatar center transparent. No source login scenery is baked in.
let panel:Box=(103,221,837,1525)
var panelPixels=crop(panel)
applyMask(&panelPixels,734,1304) { ctx in
    ctx.setFillColor(gray:1,alpha:1)
    ctx.addPath(CGPath(roundedRect:CGRect(x:1,y:1,width:732,height:1302),cornerWidth:45,cornerHeight:45,transform:nil));ctx.fillPath()
    ctx.setFillColor(gray:0,alpha:1)
    ctx.fillEllipse(in:CGRect(x:364-panel.0,y:447-panel.1,width:212,height:209))
}
save(panelPixels,734,1304,"register_modal_panel_exact.png")

let rows:[(String,Box)]=[
    ("invite",(128,706,812,796)),("nickname",(128,801,812,891)),
    ("account",(128,896,812,986)),("password",(128,991,812,1081)),
    ("confirm",(128,1086,812,1177))
]
for (name,box) in rows {
    var clean=source
    clearLiveRegion((390,box.1+17,801,box.1+72),from:&clean)
    saveCrop(box,"register_row_\(name)_exact.png",from:clean)
}

// Full opaque outer rectangle covers the square corners of real avatar files;
// only the portrait opening is transparent. It also preserves the exact frame.
let ring:Box=(356,439,584,663)
var ringPixels=crop(ring)
applyMask(&ringPixels,228,224) { ctx in
    ctx.setFillColor(gray:1,alpha:1);ctx.fill(CGRect(x:0,y:0,width:228,height:224))
    ctx.setFillColor(gray:0,alpha:1)
    ctx.fillEllipse(in:CGRect(x:364-ring.0,y:447-ring.1,width:212,height:209))
}
save(ringPixels,228,224,"register_avatar_ring_exact.png")

let toggle:Box=(686,1205,784,1260)
let off=crop(toggle)
save(off,98,55,"register_toggle_off_exact.png")
var on=off
for y in 0..<55 { for x in 0..<98 { for k in 0..<4 { on[(y*98+x)*4+k]=off[(y*98+97-x)*4+k] } } }
save(on,98,55,"register_toggle_on_exact.png")

var statusClean=source
let status:Box=(142,1283,800,1340)
clearLiveRegion(status,from:&statusClean)
saveCrop(status,"register_status_clean_exact.png",from:statusClean)
// The original icon and its background are only used at their original location.
saveCrop((313,1296,352,1335),"register_status_icon_exact.png")
saveCrop((128,1343,812,1448),"register_submit_exact.png")
saveCrop((128,1182,812,1280),"register_anti_theft_exact.png")
print("Extracted V8 registration modal and live-state overlays from approved source.")
