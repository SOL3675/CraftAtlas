# データと出力の契約

契約の正本は [JSON Schema](../schemas/) と [TypeScript 型](../packages/core/src/types.ts) です。現在の `schemaVersion` は `1`。未知の版を既知の形式へ暗黙に変換しません。

## 原本スナップショット

`--snapshot` は単一 JSON または収集ディレクトリを受け取ります。ディレクトリ形式の主なファイルは次のとおりです。

| ファイル | 意味 |
| --- | --- |
| `manifest.json` | 対象版、Mod、セッション、取得世代、ファイルの SHA-256、内容ハッシュ |
| `resources.json` / `tags.json` | 取得時点のレジストリとタグ展開 |
| `recipes.jsonl` | 1 行ごとの原本レシピ。ID・型・データ・取得エラー |
| `environment.json` | データパック・スクリプト等の取得できた環境情報とハッシュ |
| `coverage.json` | データセット・型ごとの取得 / 解釈状態と理由 |
| `viewer.json` | 任意の JEI 情報。同じセッションと取得世代が必要 |
| `completion.json` | 完了または部分取得、manifest ハッシュ、エラー |

完了マーカーがない、ハッシュが一致しない、ファイルが取得ルート外へ解決される、失敗状態である場合は読み込みを拒否します。サーバーのデータ読み取りと非同期書き込みを分離し、公開前に取得世代が変わった場合は成功データとして公開しません。JSONL はこのマニフェスト内のデータセットとして読み込みます。裸の任意 JSONL ファイルを CLI の入力契約にはしていません。

スナップショットの ID / セッション / generation は取得の同一性です。正規化モデルの `contentHash` は、版・環境・Mod・資源・処理・タグ・coverage の意味上のデータを比較します。取得時刻・新しいセッションだけをレシピ変更と扱いません。環境の意味が変われば、レシピが同じでもハッシュが変わり得ます。

`coverage.status` は `complete`、`partial`、`unsupported`、`failed`。`enumerated` が分母、`interpreted` が解釈できた件数で、不明な件数は `null` です。レシピ列挙の完了は、Loot・Worldgen・コードによる取得経路全体の網羅を意味しません。原本が保存されても、その条件を解釈できたとは限りません。

## 資源・処理・根拠

モデルは資源と処理を分けます。処理の `inputs` はスロット間が **AND**、各スロットの `alternatives` は **OR** です。タグは参照名と取得時点の `members` を保存します。候補全部を同時に消費する材料として扱いません。

入力は数量・単位と `consumed` / `catalyst` / `durability` を持ち、出力は主産物・副産物・返却物と確率を持ちます。確率 `null` は未取得、`0` は確率ゼロ、`1` は決定的な出力です。カスタム述語や Data Components の未解釈部分を、通常のアイテム ID 一致へ落としません。

設備・ステージ・ディメンション・context・opaque 条件は `requirements` に保持します。設備アイテムの所持と、設置済みで利用可能な設備は別です。後者はシナリオの `equipment`、または明示した設備 / capability 資源の構築経路で表します。stage/dimension も対応する資源種別の解放処理を辿ります。context は `scenario.gameRules.lootContext` の明示した事実と型付き predicate を比較し、未指定は unknown です。構築費と繰り返し材料費を分けます。

根拠は `runtime`、`viewer`、`definition`、`inference`、`observation` を区別し、ソース・アダプター・原本位置を参照します。処理の主要フィールドに `fieldEvidence` を持ちます。補足定義による置換は `fieldHistory` と原本を残します。最終状態から、上書きしたスクリプトのファイル / 行や削除理由を復元できるとは主張しません。

JEI はサーバーの ID が対応する処理へ表示根拠を追加し、対応が確定しないものは由来を保った別処理として保持します。カテゴリの装置候補は稼働条件の証明になりません。表示のみ / 実行可能性未確認の処理から、サバイバルでの到達を確定しません。

## シナリオと診断

[シナリオ](../schemas/scenario.schema.json) は初期在庫、利用可能設備、ステージ、ディメンション、禁止する処理 ID、許可する型、供給の仮定、閉じた資源範囲、ゲームルールを宣言します。`allowedTypes: null` は型の制限なし、空配列は全型を禁止します。

分析結果は `reachable`、`unreachable`、`unknown`。到達した場合は経路と根拠、停止した場合は満たせない条件と未知項目を返します。到達不能の確定には宣言した閉じた範囲と取得 / 解釈状態を確認します。未対応の経路がある開いた範囲では、供給源が見つからないだけで入手不能と断定しません。数量は表示・保存しますが、定性分析は有限在庫を消費する実行スケジュールを証明しません。

[期待定義](../schemas/expectations.schema.json) は必須レシピ、非空タグ、解釈が必要な型、到達可能 / 到達不能の期待を指定します。診断は安定 ID、規則、対象、severity、`confirmed` / `unknown`、シナリオ、根拠、経路、未知情報、スナップショット ID を持ちます。到達期待にはシナリオが必要です。循環は候補として扱い、外部供給や初期資源の有無を含めて説明します。

## 補足定義と SQLite

[定義パック](../schemas/definitions.schema.json) は対象 MC / ローダーと Mod の明示的な版リストを持ちます。対象不在・版不一致・セレクター不一致・重複・競合を区別します。`append` / `replace` / `disable` と追加処理を提供し、優先順位だけで競合置換を隠さず、低い優先順位の操作を `override` で明示します。ゲーム自体は変更しません。

SQLite は正規化モデルから再構築する検索キャッシュです。`buildDatabase` は 1 スナップショットを含む DB を新しいファイルで構築して公開します。追記型の履歴ストアではありません。`sources` / `uses` は入出力、タグ候補、設備の索引を使います。原本・正規化器版・使用した定義パックを保存して再構築してください。

## CLI / HTTP の機械可読出力

```json
{
  "schemaVersion": 1,
  "query": { "command": "sources", "target": "minecraft:diamond", "limit": 30, "offset": 0, "depth": 1, "snapshotId": null },
  "result": { "items": [], "total": 0, "limit": 30, "offset": 0, "truncated": false },
  "evidence": [],
  "limitations": []
}
```

ページは `items`、全件数 `total`、`limit`、`offset`、省略を示す `truncated` を返します。CLI / HTTP の上限は件数 100、offset 1,000,000、グラフ深さ 5、根拠 100 件。既定件数は 30、グラフ深さは 1 です。深さや表示打ち切りは分析そのものを制限しません。`explain` は経路の表示長を `depth × limit` に制限し、停止理由・既知資源・診断等をページとして返します。

CLI の終了コード `0` は問い合わせの正常完了、`1` は入力・実行エラーです。現状 `audit` の `0` は期待条件の合格を意味しません。`result.items` と `result.total`、各診断の重要度・状態を評価し、省略されたページを無視しないでください。ハーネスは CLI の終了コードだけで合否を決めません。

HTTP は起動時に指定したモデルだけを読む GET API です。loopback の Host とOrigin のホスト一致を確認し、検索・inspect・sources・uses・graph・coverage・diagnostics・diff・explain・cost を提供します。cost は起動時の scenario と --request、または query の JSON request を使用し、最大32768文字とスキーマを検証します。パスを指定して任意ファイルを読む API はありません。表示フィルターはシナリオの経路禁止条件を変更しません。

## World 原本と観測

Snapshot の任意 `world` は lootTables、lootModifiers、lootSources、biomes、dimensions、features、observations、limitations を持ちます。各 codec 原本は id/type/data/error として保存し、`world.json` を他 dataset と同じ manifest/checksum/意味ハッシュの対象にします。空配列を取得成功の根拠にせず dataset 別 coverage を確認します。

Loot のテーブル・参照・条件・関数と、後段 modifier の実適用順を保存します。既定の block/Mob mapping はイベント全体の証明ではありません。未知コードや出力変更が残る場合は確定到達へ昇格しません。適用済み biome/spawn、dimension generator の biome membership と generation settings から feature 関係を辿り、registry-only feature と分けます。生成率やコードによる spawn 制限は未解釈です。

観測は session/generation/environment hash、seed、generator、dimension、chunk、player、difficulty、biome、context、時刻/weather/gameRules、試行数と結果を保存します。観測自身の manifest/completion を検証し、同じ世代の dump のみへ添付します。意味比較では取得用 ID/時刻/session/generation を除き、試行条件と結果は保持します。有限観測 process は display/unknown として扱い、不存在・定常供給率・無限供給を証明しません。

## 選択経路の計算契約

[cost-request](../schemas/cost-request.schema.json) は target の資源/数量/単位、routes の process と output index、selections の OR 材料、mode、probabilityModels、durability、任意 inventoryUnits を宣言します。循環や禁じた処理、単位不一致は invalid、未解釈条件や追加分布が必要な計算は unknown とします。最大1000展開・深さ100・数量1e12の範囲です。

結果は setup/recurring の材料・コスト、バッチ、返却物、副産物、触媒、耐久、根拠・診断を保持します。単位別 cost は未知の総額 amount=null と既知の小計 knownSubtotal を分けます。選択経路の積算であり最適化や並列の完了時刻は計算しません。

IID Bernoulli の明示宣言で期待試行数と試行分散を計算し、出力間の独立性は independentOutputs で別に宣言します。ランダム副産物を供給へ自動充当せず、期待値だけで有限在庫・バッチ丸め・耐久交換を確定しません。完全分布が不足する上流は mean-flow/unknown、全材料・総コストの結合分散は対象外です。CLI/HTTP は配列ごとに通常のページ契約を使い、同一 core 計算を返します。

## ハーネス結果と成果物

process Suite は `{ "schemaVersion": 1, "cases": [...] }` の既存契約を使います。`passed` / `failed` / `unsupported` / `skipped` / `infrastructure-error` を区別し、必須ケースの未検出・0 件・未実行・未対応を成功へ昇格しません。必須の未解釈項目は `unsupported` として残します。

Gradle の `harnessExport` は対象・解決済み MC / ローダー / mappings、配布 JAR、固定 runtime dependencies の path / side を明示します。`craft-atlas-collector-0.1.0.jar` は `distribution` / `both`、JEI は `runtime-dependency` / `client`、Mekanism・CraftTweaker は `runtime-dependency` / `both` です。sources JAR や開発用 JAR を配布 JAR として選びません。ビルド成果物は Run にコピーし、SHA-256 で参照します。

| ソース | ビルド・実行の対応 |
| --- | --- |
| `mods/collector/src/main/java/` | Gradle Wrapper → 明示した collector 配布 JAR |
| `packages/cli/src/main.ts` | Node 24 で直接実行、または `dist/packages/cli/src/main.js` |
| `packages/core/` / `schemas/` | コンパイルした core と `dist/schemas/` |
| `packages/web/src/` / `packages/web/public/` | HTTP server と `dist/packages/web/public/` |
| `packages/harness/src/` | process Suite の standalone ラッパー。今回の Run 内へ結果・根拠を保存 |

スナップショット、DB、診断、差分、測定値、ゲームログ、`evidence.json` は `.harness/runs/<run-id>/sessions/.../` に保存します。大きな証拠はケース結果へ埋め込まず Run 内で保持し、入力ハッシュ・Pack lock ハッシュ・配布成果物・run ID から追跡します。
