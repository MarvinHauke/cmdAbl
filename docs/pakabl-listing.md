# List your extension in pakabl

pakabl installs Ableton Live extensions (`.ablx` files) from a curated list of community repositories. This page is
for extension authors: it says what your repository needs and how to get it on the list. Users see the list with
`pakabl list` (see [Getting started](getting-started.md#install-more-extensions-with-pakabl)).

## What your repository needs

- **A GitHub repository** that publishes an `.ablx`: either as an asset of the latest GitHub Release, or as a file
  committed in the repository.
- **A `manifest.json` inside the `.ablx`** with `name`, `author`, `version` and a `minimumApiVersion` that starts with
  `1.`. pakabl downloads the `.ablx` and reads the manifest, so these values come from the file itself, not from the
  file name. An `.ablx` without them, or with another API version, is skipped.
- **An extension id** that follows from the manifest: `<author-slug>.<name-slug>`. A slug is the text in lowercase
  with every run of characters other than `a`–`z` and `0`–`9` turned into one dash, and no dash at either end. The
  author "Federico Pepe" and the name "Track Creator" give `federico-pepe.track-creator`.
- **Version numbers** that sort: if a repository has several `.ablx` files for one id, the newest version wins. Parts
  are compared as numbers, split at dots and dashes.

## Get your extension listed

pakabl lists only repositories that cmdAbl's maintainers have approved. The reason: an installed extension runs inside
Live's Extension Host, and a crash in one takes down all of them.

1. Check that your repository meets the list above.
2. Ask for the listing in one of two ways:
   - Open a pull request on [cmdAbl](https://github.com/MarvinHauke/cmdAbl) that adds one line to
     `pakabl/sources.json`:

     ```json
     { "repo": "<owner>/<repo>" }
     ```

     To skip one extension of a repository, add `"exclude": ["<extension-id>"]` to the line. Do not edit
     `pakabl/index.json` or `pakabl/candidates.json`; they are generated.
   - Or open an [issue](https://github.com/MarvinHauke/cmdAbl/issues) with the repository name.
3. A maintainer looks at the repository and approves it. After that, the next daily crawl adds your extension.

Giving your repository the GitHub topic `ableton-extension` or `ableton-extensions` helps: pakabl searches for those
topics, and a repository that ships an `.ablx` and is not approved yet is put on a list of candidates for review.
Being a candidate does not show it to users.

## New versions

Publish a new release with the new `.ablx`, or commit it. The crawl runs daily and picks up the newest version of every
approved repository. After the refreshed list is merged, users get the new version with `pakabl update`; the
**Update** button in `pakabl list` appears when the list holds a newer version than the installed one. GitHub's cache
of raw files can delay it by a few minutes.
