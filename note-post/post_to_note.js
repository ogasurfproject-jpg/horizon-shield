name: note自動投稿

on:
  schedule:
    - cron: '0 0 * * *'  # 毎日09:00 JST（UTC 00:00）
  workflow_dispatch:       # 手動実行も可能

jobs:
  post-to-note:
    runs-on: ubuntu-latest

    steps:
      - name: リポジトリをチェックアウト
        uses: actions/checkout@v4

      - name: Node.jsセットアップ
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 依存パッケージインストール
        run: |
          cd note-post
          npm install

      - name: Puppeteer用のChrome依存関係インストール
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libnss3 \
            libatk-bridge2.0-0 \
            libdrm2 \
            libxkbcommon0 \
            libgtk-3-0 \
            libgbm1 \
            libasound2

      - name: note記事を自動投稿
        env:
          NOTE_EMAIL: ${{ secrets.NOTE_EMAIL }}
          NOTE_PASSWORD: ${{ secrets.NOTE_PASSWORD }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LINE_CHANNEL_TOKEN: ${{ secrets.LINE_CHANNEL_TOKEN }}
          LINE_USER_ID: ${{ secrets.LINE_USER_ID }}
        run: |
          cd note-post
          node post_to_note.js
