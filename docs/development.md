# CraftAtlas の開発構成と CraftFoundry 依存

CraftAtlas の実ディレクトリは `F:\workspace\craft-atlas`、npm 名は `craft-atlas` です。Git 履歴は CraftFoundry と独立しています。`packages/core`、`cli`、`web`、`harness` は一つの TypeScript プロジェクトのソース区分で、個別 npm workspace ではありません。NeoForge と Fabric の収集 Mod は `mods/collector` と `mods/collector-fabric` の独立 Gradle root です。

CraftFoundry の実ディレクトリは現在 `F:\workspace\mc-dev-harness`、npm 名は `craft-foundry`、互換 CLI は `mch` です。CraftAtlas は `file:craft-foundry-0.1.1.tgz` を開発依存に持ちます。tarball と pnpm の integrity を Git 管理し、ソースや開発用シンボリックリンクには依存しません。Node.js 24 と pnpm 11.19.0 を使用します。

## 検証

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
pnpm exec mch --help
pnpm exec mch targets --json
pnpm exec mch doctor --json
pnpm exec mch inspect --target neoforge-1.21.1 --json
pnpm exec mch build --target neoforge-1.21.1 --json
pnpm exec mch test --target neoforge-1.21.1 --suite atlas-offline --json
```

Fabric も `--target fabric-1.21.1` で inspect / build / atlas-offline を確認します。Minecraft / Java の前提を診断した後、変更に関係する実ゲーム Suite を [使い方](usage.md) と [Fabric 手順](fabric.md) に従って実行します。全必須 Suite を実行していない検証を release 合格とは扱いません。

runtime アダプターは `craft-foundry/core/*` と `craft-foundry/adapters/runtime/*` の明示 export を利用します。相対的な `node_modules` パスに依存しないため、TypeScript ソースと `dist/packages/harness/src/` の両方で同じ依存を解決できます。CLI の呼出しは `pnpm exec mch` または `node node_modules/craft-foundry/dist/cli/main.js` を使用します。

## ハーネス更新

1. CraftFoundry 側でパッケージ版を上げ、`npm run check` と `npm pack` を実行します。
2. 生成した新しい tarball を CraftAtlas のルートに配置し、`pnpm add --save-dev --save-exact ./craft-foundry-<version>.tgz --ignore-scripts` で依存と lockfile を更新します。旧名からの初回移行では `mc-dev-harness` を開発依存から外します。旧 tarball は参照がなくなってから取り除きます。
3. CLI、明示 API、Schema、Skills が同じ版の配布物から解決されることを確認します。`pnpm exec mch skills install --destination .agents/skills --json` は利用者の編集を保全し、導入先の `.agents/skills/.mch-skills.json` を更新します。この記録を Git 管理し、実体の Skill は配布物から復元します。
4. 上記の frozen install / 型検査 / テスト / ビルドと対象 Suite を実行し、新 tarball・package.json・lockfile・Skills の記録を一緒にレビューします。同じ版の tarball を内容だけ差し替えないでください。

## 将来の private repository / サブモジュール

両リポジトリに remote はまだありません。各既存履歴を別々の GitHub private repository へ push した後、CraftFoundry 内の `projects/craft-atlas` に、この一つの checkout を停止時間中に移動してサブモジュール登録する予定です。今回は移動・複製・`.gitmodules` 作成・remote 設定・push をしていません。元 checkout を二重管理しません。

子は自身の commit と pnpm lockfile を管理し、親は子 commit の gitlink を管理します。親 npm workspace に子を混ぜず、ハーネス配布物に CraftAtlas を同梱しません。クラウドでは private 子リポジトリへのアクセスを準備し、submodule の commit を復元して、親 npm と子 pnpm を別々にインストールします。

この端末の `harness.local.json` は旧 CraftFoundry パスのツールと asset cache を共有しています。ディレクトリ移動時やクラウド移行時は実在するパスに設定し直してください。Java home・EULA・認証情報を共有設定へ移さず、過去の Run と検証記録は当時の名称を保持します。
