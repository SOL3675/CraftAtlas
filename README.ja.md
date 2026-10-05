# CraftAtlas

[English](README.md) | [開発手順](docs/development.md)。CraftFoundry の固定コミットから未公開パッケージを生成して利用します。tarball やビルド成果物は Git に含めません。

Minecraft Java の実行時レシピ・タグを保存し、ゲーム終了後も取得経路、変更差分、期待条件を調べるローカルツールです。Java の収集 Mod と、TypeScript の正規化・SQLite・CLI・Web UI を分離しています。

収集対象は次の 4 構成です。

| 対象 | ローダー | Java | 任意ビューア |
| --- | --- | --- | --- |
| NeoForge 1.21.1 | 21.1.252 | 21 | JEI 19.22.1.316 |
| Fabric 1.21.1 | 0.16.14 / API 0.116.17+1.21.1 | 21 | EMI 1.1.24+1.21.1 |
| Forge 1.20.1 | 47.3.0 | 17 | JEI 15.20.0.106 |
| Fabric 1.20.1 | 0.16.14 / API 0.92.7+1.20.1 | 17 | EMI 1.1.24+1.20.1 |

1.20.1 実装はオフライン契約テストを備えています。Minecraft のコンパイルと専用・統合サーバーでの実行確認は、固定依存と Java 17 が利用できる環境で別途必要です。他の版・ローダー構成への対応は推測しません。対応範囲は [契約と制約](docs/contracts.md) と [Fabric 手順](docs/fabric.md) を参照してください。未取得・未解釈を「存在しない」「入手不能」に変換しません。

## オフラインで試す

Node.js 24 と pnpm 11.19.0 を使用します。以下はリポジトリのルートで実行します。保存済み fixture の表示には Minecraft や Java は不要です。

```powershell
node scripts/prepare-foundry.mjs --source ../CraftFoundry
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm atlas serve --snapshot fixtures/after.json --scenario fixtures/scenario.json --before fixtures/before.json
```

表示された [ローカル UI](http://127.0.0.1:4317) を開き、`diamond` を検索してください。資源と処理の局所グラフ、AND / OR、数量、設備、根拠、未知条件を確認できます。検索の Mod フィルターは表示だけを変更し、分析の禁止経路には影響しません。

変更比較では、`--before` に旧スナップショット、`--snapshot` に新スナップショットを指定します。

```powershell
pnpm atlas import --snapshot fixtures/before.json --db .harness/demo.sqlite --json
pnpm atlas sources minecraft:diamond --db .harness/demo.sqlite --json
pnpm atlas explain minecraft:diamond --snapshot fixtures/before.json --scenario fixtures/scenario.json --json
pnpm atlas diff --before fixtures/before.json --after fixtures/after.json --json
```

詳しいコマンド、実ゲーム収集、ハーネス接続は [使い方](docs/usage.md)、データの意味と機械可読出力は [契約](docs/contracts.md) に記載しています。

## 対応範囲

| 領域 | 現在の範囲 |
| --- | --- |
| サーバー収集 | 上記 4 構成の専用・統合サーバー。アイテム / 流体 / ブロック / Mob、タグ、適用後レシピ、環境ハッシュ |
| 基本レシピ | 対象版の crafting、smelting 等。特殊・動的レシピ、独自述語は原本と未知理由を保持 |
| JEI | NeoForge 1.21.1 は 19.22.1.316、Forge 1.20.1 は 15.20.0.106。統合サーバーと同じセッション・取得世代での任意収集。専用サーバーへ接続したリモートクライアントのビューア収集は未対応 |
| 機械アダプター | 1.21.1 の固定 Pack に限定。Mekanism 10.7.14.79 の enriching の入出力と数量。動作には未解析の電力供給条件が残り、エネルギー・時間の総コストは確定しない。他の Mekanism レシピ型は opaque |
| レシピ変更 | 固定した CraftTweaker 21.0.38 とデータパック。KubeJS は今回の固定環境には含めない |
| 到達分析 | シナリオ内の初期資源・設置済み設備・ステージ・ディメンション・禁止処理を使う定性分析。有限在庫で実行可能な数量付き手順は証明しない |
| Loot / Worldgen | 実行時テーブル・参照・基本条件/関数、NeoForge / Forge の実適用 Global Loot Modifiers、適用済み biome/spawn/feature と生成器の関係。イベントや独自コード・生成率は unknown |
| 観測 | 1.21.1 および Forge/Fabric 1.20.1 に loot/block/entity/world の有限観測コマンドを実装。試行条件、NBT、世代・環境と原本を保存。供給率や不存在は証明しない。1.20.1 の追加実装は新しい実機検証が必要 |
| 進行・材料コスト | 選択した経路の数量・バッチ・初期設備と反復費、触媒・耐久・返却物。明示した IID 確率モデルだけ期待値と試行分散を計算 |
| Fabric / EMI / 追加 Mod | 1.21.1 は EMI 1.1.24+1.21.1+fabric と TechReborn 5.11.19 grinder。1.20.1 は EMI 1.1.24+1.20.1+fabric、TechReborn アダプターは対象外。実機で確認した範囲・未対応は [対応表](docs/fabric.md) を参照 |

[固定依存](fixtures/pack.lock.json) は配布ファイルと SHA-256 を記録します。同梱の [設備定義](definitions/fixture-equipment.json) は架空の設備を使うオフライン契約 fixture であり、実 Mod の設備構築や儀式を検証した証拠ではありません。

[進行 fixture](definitions/fixture-progression.json) も架空の召喚・魔法陣・ディメンション解放を扱う契約検証です。材料コストは次の例で確認できます。

```powershell
pnpm atlas cost --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json --json
pnpm atlas serve --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json
```

Mod 独自の取得方法は、バージョン限定の DefinitionPack で入力・出力・条件を記述できます。独自 serializer の解釈状態、キャプチャに基づくタグ展開、参照検証と coverage の扱いは [定義契約](docs/contracts.md)、Foundry との開発チェックは [開発手順](docs/development.md#mod-acquisition-definitions) を参照してください。未検証の Java hook は unknown を維持します。

サーバーのダンプでは、JEI/EMI を使わずに、有効な Mod 同梱データパックのレシピ JSON 原本と上書きの由来も保存します。`atlas datapack` で確認できます。任意のカスタム JSON ディレクトリの収集設定と定義の作成方法は [使い方](docs/usage.md#fixed-collectors) を参照してください。原本の収集は、レシピの登録や実行可能性を証明するものではありません。1.20.1 は `recipes` / `tags/items`、1.21.1 は `recipe` / `tags/item` を収集します。1.20.1 に汎用レシピ JSON encoder はないため、実行時 ID・型・network bytes の base64 / SHA-256 と、検証対象の vanilla フィールドを保存します。特殊・独自レシピや NBT の意味は unknown を維持し、原本 JSON で実行時証拠を置き換えません。

1.20.1 の Java 17、ForgeGradle / Loom、固定サーバー・helper、ビューアと Suite の実行コマンドは [1.20.1 手順](docs/usage.md#forge-and-fabric-1201) を参照してください。収集 Mod とは別の架空データ専用 fixture Mod をハーネスに配備し、同梱 JSON の上書き・source-only / runtime-only・reload を確認します。通常の collector に fixture レシピは追加しません。Foundry 自身の repository-only survival runner は既存の 1.21.1 範囲を維持します。

性能の測定方法と予算は [性能測定](docs/performance.md) を参照してください。

## 構成

| パス | 責務 |
| --- | --- |
| `mods/collector/` | Gradle Wrapper、NeoForge 収集 Mod、任意 JEI 連携 |
| `mods/collector-fabric/` | 独立 Gradle Wrapper、Fabric 収集 Mod、任意 EMI 連携 |
| `mods/collector-forge-1.20.1/` / `mods/collector-fabric-1.20.1/` | 独立 Java 17 ビルド、Forge / Fabric 1.20.1 と JEI / EMI |
| `mods/collector-1.20.1-common/` | 1.20.1 の共通 Minecraft API とレシピ network 取得。1.21.1 API とは分離 |
| `schemas/` / `packages/core/` | 原本・共通モデルの契約、正規化、SQLite、分析、監査、差分、定義の適用 |
| `packages/cli/` / `packages/web/` | CLI / JSON、読み取り専用のローカル UI |
| `packages/harness/` | process Suite のゲーム起動・準備・収集・終了と新規結果の保存 |
| `fixtures/` / `definitions/` | 固定 Pack、変更 fixture、シナリオ、期待条件、補足定義 |

```powershell
pnpm build
node dist/packages/cli/src/main.js validate --snapshot fixtures/before.json --json
```

ビルドは JavaScript と併せて `dist/schemas/` と `dist/packages/web/public/` を生成します。配布した CLI でも同じスキーマと UI を使用できます。

ソース取得には Git、ビルドには npm 11.9.0 と Node 24.19.0 が必要です。`--source` を省略すると記録済み origin から固定コミットを取得します。Windows でも同じ Node コマンドを使えます。将来 `CraftFoundry/projects/craft-atlas` に配置する場合は `--source ../..` を指定します。

## ライセンス

CraftAtlas 独自のコードとドキュメントには [MIT](LICENSE) を適用します（Copyright (c) 2026 SOL3675）。第三者のライセンスと著作権表示は維持します。Gradle Wrapper スクリプトの Apache-2.0 ヘッダーと JAR 内の `META-INF/LICENSE` は変更しません。依存ライブラリ、取得する Mod、Minecraft はそれぞれのライセンスに従います。ビルド時に LICENSE を `dist/` へコピーし、collector のバイナリ・ソース JAR には `META-INF/LICENSE` として同梱します。プロジェクトは引き続き未公開・`private: true` です。

1.20.1 の有限観測が未対応だった理由は Minecraft の仕様上の不可能性ではなく、移植の未実装でした。`/craftatlas observe loot|block|entity|world` を両ローダーに追加しています。loot 試行は 1–1000 回、world は半径 0–1 chunk・高さ最大 64 ブロックに制限します。block/entity は Loot context の評価であり、実際の破壊・死亡イベントを発生させず、アイテムを付与しません。観測には chunk の読み込み・生成が伴う場合があります。必要な context の不足、同名出力、取得中・reload 中の要求は拒否し、reload 前の結果は新しい世代へ添付しません。

追加の `atlas-1.20.1-world` Suite を Forge/Fabric の両方で実行し、続けて 4 target の release 検証を行ってください。新 Suite は 7 case を要求し、確定/空 Loot、Forge modifier、通常/Silk Touch の道具 NBT、Mob context、有限 chunk、manifest/hash、拒否と reload 無効化を実ゲームで確認します。統合ワールドのプレイヤー context と権限確認も必要です。追加実装に対するコンパイル・実機成功はまだ未確認であり、以前の PR 検証結果やオフライン契約テストでは代替できません。[手順](docs/usage.md#validate-the-1201-observation-port)を参照してください。
