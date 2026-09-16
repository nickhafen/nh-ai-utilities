# Batch Download script fixtures

Manual checks for `download-files.ps1`, which lives only as a constant in
`js/shared/batch-download-script.js`. Re-run them whenever the script changes.

## Hostile CSV

`hostile.csv` holds rows the script must refuse or handle safely: UNC paths,
`file://`, `ftp://` and `javascript:` URLs, path traversal and drive letters in
filenames, reserved names, blocked extensions, duplicates, an overlong name, a
non-ASCII name, HTML served instead of a document, HTTP errors, an empty file,
an unreachable host, and `auto`-type rows. The extra `Expect` column (ignored
by the script) says what each row should produce.

1. Start the test server: `py tests/fixtures/test-server.py`
   (serves fixed responses on `http://127.0.0.1:8765`).
2. Get the script the real way: open Document Tools, add any document with
   links, choose **Batch Download**, and click **Download bundle (.zip)**.
   Unzip it.
3. Replace the bundle's `files.csv` with `hostile.csv` (keep the name
   `files.csv`).
4. Double-click `Run Download.cmd`.
5. Check that every row's `[OK]` / `[SKIPPED]` / `[FAILED]` line matches its
   `Expect` value, that `Downloaded Files` holds only the expected files (no
   `.part` files), and that `download-log.csv` has one row per CSV row.

## Failure paths

Run the script in a bundle folder set up as follows:

| Setup | Expected message |
|---|---|
| Delete `files.csv` | "Cannot find files.csv next to this script…" |
| `files.csv` with other column names | "files.csv is not in the expected format…" |
| `files.csv` with only the header row | "files.csv is not in the expected format…" |
| A **file** named `Downloaded Files` in the folder (or a read-only folder) | "Could not create or write to the 'Downloaded Files' folder here…" |
| Bundle folder deep enough that a long filename passes 250 characters | "Skipped: the full path is too long for Windows…" for that row only |
