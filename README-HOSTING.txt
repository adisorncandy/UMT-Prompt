UMT Prompt Studio - Ready to Host (Update 24)

Upload every file in this folder to your web hosting public/root folder and overwrite old files.

Required files:
- index.html
- assets/
- _headers
- .htaccess

This build includes prompt data migration version 2026-09-14-v24. If a browser already saved old prompt thumbnails under the same site, the app refreshes default prompts from the new bundled prompt data while preserving custom user-added prompts.

Thumbnail paths use relative ./assets/... URLs so local SVG thumbnails work when hosted in a subfolder.

The app has no required server API or database for normal prompt browsing. User data is saved in the browser via localStorage.

Note: The source project includes a Node/Express API bundle for server-side thumbnail generation. This ready-to-host package is the static upload version.
