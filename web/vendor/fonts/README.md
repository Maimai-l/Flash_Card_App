# Bundled fonts

`archivo-latin.woff2` and `archivo-latin-ext.woff2` are the Latin and Latin
Extended subsets of **Archivo** (Omnibus-Type), v25, taken from Google Fonts.
They are variable files covering weights 400 to 800, so the whole interface
needs two requests and about 68 KB rather than one file per weight.

The app never talks to a CDN, so the font is served from here like KaTeX is.
`OFL.txt` is the SIL Open Font License 1.1 the family is released under.

No Chinese font is bundled. A CJK face is several megabytes even subsetted, and
the systems this app runs on already ship a good one; `base.css` picks it and
maps the heavy weights onto a real cut instead of a synthesised bold.
