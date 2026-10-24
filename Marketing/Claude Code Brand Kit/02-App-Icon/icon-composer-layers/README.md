# Icon Composer layers

Optional upgrade from `AppIcon.appiconset` to a layered Liquid Glass icon.

1. Open Icon Composer (Xcode > Open Developer Tool > Icon Composer) and create a new icon.
2. Background: set the fill to a linear gradient from `#1A4280` (top) to `#06122A` (bottom).
3. Drag the layers in this order, bottom to top: `1-H.svg`, `2-Q.svg`, `3-Arrow.svg`.
   They share one 1024 canvas, so they line up automatically.
4. Glass: on for Arrow, subtle on Q, off for H. Check the Dark, Tinted and Clear previews.
5. Save the file as `AppIcon.icon` and drag it into the Xcode project. Then set
   *Target > General > App Icon* to `AppIcon`.

If you skip this step, the `AppIcon.appiconset` (default, dark and tinted PNGs) works as-is.
