import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A chat photo ready to upload (D-036): downsized and re-encoded as a JPEG with no
/// metadata, so GPS location and camera details never leave the phone.
nonisolated struct ChatPhoto: Sendable {
    let jpeg: Data
    let width: Int
    let height: Int

    /// Longest edge after downsizing. Plenty for a phone screen; keeps uploads small.
    static let maxPixelSize = 1600

    enum EncodingError: LocalizedError {
        case unreadable
        var errorDescription: String? { "That photo couldn't be read. Try a different one." }
    }

    /// Decodes any format ImageIO reads (HEIC, JPEG, PNG…), applies the EXIF orientation,
    /// and writes a fresh JPEG. No source properties are copied into the output.
    static func make(from data: Data, maxPixelSize: Int = ChatPhoto.maxPixelSize) throws -> ChatPhoto {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw EncodingError.unreadable }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true, // bake in orientation
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw EncodingError.unreadable
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw EncodingError.unreadable
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw EncodingError.unreadable }
        return ChatPhoto(jpeg: output as Data, width: image.width, height: image.height)
    }
}
