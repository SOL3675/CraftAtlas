# CraftAtlas

[English](README.md)

CraftAtlas は Minecraft Java のレシピ・タグ・ワールドデータを保存し、ゲーム終了後も取得経路、必要条件、材料コスト、変更差分を調べられるツールです。CLI または読み取り専用のローカル Web UI を使用します。未取得・未解釈のデータは unknown のまま扱います。

## オフラインで試す

Git、Node.js 24.19.0、npm 11.9.0、pnpm 11.19.0 を使用します。リポジトリのルートで以下を実行すると、インストールして同梱のサンプルデータを表示できます。この例には Minecraft や Java は不要です。

```console
node scripts/prepare-foundry.mjs
pnpm install --frozen-lockfile --ignore-scripts
pnpm atlas serve --snapshot fixtures/after.json --scenario fixtures/scenario.json --before fixtures/before.json
```

[ローカル UI](http://127.0.0.1:4317) を開き、`diamond` を検索してください。数量、AND / OR、設備、根拠、未知条件を確認できます。終了は Ctrl+C です。Mod フィルターは表示を変更し、分析の制限はシナリオから設定します。変更比較では `--before` に旧スナップショット、`--snapshot` に新スナップショットを指定します。

最初のコマンドは固定した CraftFoundry 依存を取得します。既存のチェックアウトを使う場合は `--source ../CraftFoundry` を追加してください。復元・ビルド・テストの手順は [セットアップと開発](docs/development.md) を参照してください。

## CLI と実ゲームの収集

```console
pnpm atlas validate --snapshot fixtures/before.json --json
pnpm atlas import --snapshot fixtures/before.json --db .harness/demo.sqlite --json
pnpm atlas sources minecraft:diamond --db .harness/demo.sqlite --json
pnpm atlas explain minecraft:diamond --snapshot fixtures/before.json --scenario fixtures/scenario.json --json
pnpm atlas diff --before fixtures/before.json --after fixtures/after.json --json
```

コマンドと実ゲームデータの収集は [使い方](docs/usage.md) を参照してください。対応する収集 Mod を導入し、オペレーターとして `/craftatlas dump <label>` を実行して収集完了を待ちます。`--snapshot` のサンプル JSON パスは、完了済みの収集ディレクトリに置き換えられます。任意の JEI/EMI 収集は統合ワールドで利用できます。専用サーバーに接続したリモートクライアントのビューア収集は未対応です。

サーバーのダンプは JEI/EMI を使わずに、有効な Mod 同梱データパックのレシピ JSON 原本と上書きの由来も保存します。`atlas datapack` で確認できます。任意のカスタム JSON ディレクトリは [収集設定](docs/usage.md#fixed-collectors) を参照してください。原本 JSON の収集は、レシピの登録や実行可能性を証明するものではありません。

Mod 独自の取得方法は、バージョン限定の DefinitionPack で入力・出力・条件を記述できます。定義の作成、タグ展開、参照と解釈の制約は [データ契約](docs/contracts.md) を参照してください。未検証の Java hook は unknown を維持します。

## 対応環境と制約

| 対象 | ローダー / API | Java | 任意のビューア |
| --- | --- | --- | --- |
| NeoForge 1.21.1 | 21.1.252 | 21 | JEI 19.22.1.316 |
| Fabric 1.21.1 | 0.16.14 / API 0.116.17+1.21.1 | 21 | EMI 1.1.24+1.21.1+fabric |
| Forge 1.20.1 | 47.3.0 | 17 | JEI 15.20.0.106 |
| Fabric 1.20.1 | 0.16.14 / API 0.92.7+1.20.1 | 17 | EMI 1.1.24+1.20.1+fabric |

他のバージョン・ローダーの組み合わせは未対応です。環境別の詳細は [1.20.1 の使い方](docs/usage.md#forge-and-fabric-1201) と [Fabric 手順](docs/fabric.md) を参照してください。

| 領域 | 現在の範囲 |
| --- | --- |
| サーバー収集 | 上記 4 構成の専用・統合サーバー。アイテム、流体、ブロック、Mob、タグ、適用後レシピ、環境ハッシュ |
| 基本レシピ | crafting、smelting 等の対応する vanilla 型。特殊・動的レシピ、独自述語は原本と未知理由を保持 |
| 機械アダプター | 固定した 1.21.1 Pack の Mekanism enriching と TechReborn grinder。他の機械型は opaque で、供給電力や経過時間は確定しない |
| 到達分析 | シナリオ内の初期資源、設置済み設備、ステージ、ディメンション、禁止処理を使う定性分析。有限在庫で実行可能な手順は証明しない |
| Loot / Worldgen | 実行時テーブル、参照、基本条件/関数、NeoForge / Forge の実適用 Global Loot Modifiers、biome/spawn/feature の関係。任意のイベント、独自コード、生成率は unknown |
| 観測 | 上記環境で loot/block/entity/world の有限サンプルを収集。記録した context と結果は、不存在、生成率、持続可能な供給を証明しない |
| 進行・材料コスト | 宣言した必要条件と選択経路の数量、バッチ、初期設備・反復費、触媒、耐久、返却物。期待値と試行分散は明示した IID 確率モデルが必要 |

ビューア表示は実行の証明ではありません。Forge 1.20.1 の JEI 流体収集は実行時未検証です。結果の解釈は [データ契約と制約](docs/contracts.md)、測定方法と予算は [性能測定](docs/performance.md) を参照してください。

## ライセンス

CraftAtlas 独自のコードとドキュメントには [MIT](LICENSE) を適用します（Copyright (c) 2026 SOL3675）。第三者のライセンスと著作権表示は維持します。Gradle Wrapper スクリプトの Apache-2.0 ヘッダーと JAR 内の `META-INF/LICENSE` は変更しません。依存ライブラリ、取得する Mod、Minecraft はそれぞれのライセンスに従います。ビルド時に LICENSE を `dist/` へコピーし、collector のバイナリ・ソース JAR には `META-INF/LICENSE` として同梱します。npm パッケージは未公開・`private: true` です。
