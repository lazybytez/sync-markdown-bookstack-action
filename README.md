# Sync Markdown to BookStack Action
This action allows to synchronize one or more markdown files to BookStack.
This makes it possible to maintain documentation within a repository while still
making it available in your central documentation solution.

This action features:
 - Sync to either a chapter or a book
 - Use either a single file or a glob pattern to sync multiple files
 - Add tags to the generated pages
 - Keep your pages up to date - the action can create and update pages

## Inputs

### `bookstack-url`
 - **Required** 
 - The URL to your BookStack instance, where the files will be synced to.

### `bookstack-token-id`
 - **Required**
 - The id of your BookStack API connection.

### `bookstack-token-secret`
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