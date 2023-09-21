# Sync Markdown to BookStack Action

[![gh-commit-badge][gh-commit-badge]][gh-commit]
[![gh-contributors-badge][gh-contributors-badge]][gh-contributors]
[![gh-stars-badge][gh-stars-badge]][gh-stars]

## Description
This action allows to synchronize one or more markdown files to BookStack.
This makes it possible to maintain documentation within a repository while still
making it available in your central documentation solution.

This action features:
 - Sync to either a chapter or a book
 - Use either a single file or a glob pattern to sync multiple files
 - Add tags to the generated pages
 - Keep your pages up to date - the action can create and update pages

## Limitations
To support globs and therefore the creation of multiple pages at once,
this action uses the **first** headline of type **# (h1)** as the name for the created pages.

This means your markdown files **must** have at least one **#** to be accepted by the Action.

## Inputs

### `url`
 - **Required** 
 - The URL to your BookStack instance, where the files will be synced to.

### `token-id`
 - **Required**
 - The id of your BookStack API connection.

### `token-secret`
 - **Required**
 - The secret of your BookStack API connection.

### `book-id`
 - **Required, when `chapter-id` is not set** 
 - The ID of the book to sync to.

### `chapter-id`
 - **Required, when `book-id` is not set** 
 - The ID of the book to sync to.

### `tags`
 - The tags to add to the page, comma separated

### `path`
 - The path to the markdown file(s) to sync, you can use glob patterns for multiple files

## Outputs
This action does not output anything, if everything goes well.

## Example usage

```yaml
uses: lazybytez/sync-markdown-bookstack-action@1.0.0
with:
  bookstack-url: 'https://bookstack.your.url'
  bookstack-token-id: '{{ secrets.BOOKSTACK_TOKEN_ID }}'
  bookstack-token-secret: '{{ secrets.BOOKSTACK_TOKEN_SECRET }}'
  # You only need one of book-id or chapter-id
  book-id: 123
  chapter-id: 123
  tags: 'action,sync,bookstack'
  # You can either use a path to a file or a glob pattern:
  path: 'sub/directories/README.md'
  path: 'sub/*/*.md'
```

## Development
To develop locally, you should install **NodeJS 20**.

The following commands can be used for local development:
```
# Install dependencies
$ npm install

# Format and bundle for distribution
$ npm run bundle

# Only check code style using prettier
$ npm run format:check

# Check code style and reformat
$ npm run format:write
```

Be sure to always run the bundler and commit the `dist/` directory when doing changes to the code.

## Contributing

If you want to take part in contribution, like fixing issues and contributing directly to the code base, please visit
the [How to Contribute][gh-contribute] document.

## Useful links

[License][gh-license] -
[Contributing][gh-contribute] -
[Code of conduct][gh-codeofconduct] -
[Issues][gh-issues] -
[Pull requests][gh-pulls]

<hr>  

###### Copyright (c) [Lazy Bytez][gh-team]. All rights reserved | Licensed under the MIT license.

<!-- Variables -->

[gh-commit-badge]: https://img.shields.io/github/last-commit/lazybytez/sync-markdown-bookstack-action?style=for-the-badge&colorA=302D41&colorB=cba6f7

[gh-commit]: https://github.com/lazybytez/sync-markdown-bookstack-action/commits/main

[gh-contributors-badge]: https://img.shields.io/github/contributors/lazybytez/sync-markdown-bookstack-action?style=for-the-badge&colorA=302D41&colorB=89dceb

[gh-contributors]: https://github.com/lazybytez/sync-markdown-bookstack-action/graphs/contributors

[gh-stars-badge]: https://img.shields.io/github/stars/lazybytez?style=for-the-badge&colorA=302D41&colorB=f9e2af

[gh-stars]: https://github.com/lazybytez/sync-markdown-bookstack-action/stargazers

[gh-contribute]: https://github.com/lazybytez/.github/blob/main/docs/CONTRIBUTING.md

[gh-license]: https://github.com/lazybytez/sync-markdown-bookstack-action/blob/main/LICENSE

[gh-codeofconduct]: https://github.com/lazybytez/.github/blob/main/docs/CODE_OF_CONDUCT.md

[gh-issues]: https://github.com/lazybytez/sync-markdown-bookstack-action/issues

[gh-pulls]: https://github.com/lazybytez/sync-markdown-bookstack-action/pulls

[gh-team]: https://github.com/lazybytez
