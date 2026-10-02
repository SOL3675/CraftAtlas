# Fabric 固定対象

Minecraft 1.21.1 / Fabric Loader 0.16.14 / Fabric API 0.116.17+1.21.1 を独立した Gradle root `mods/collector-fabric` でビルドする。Loom は 1.8.13、Gradle は 8.10、Java は 21。共通 Minecraft 部の `JsonFiles`、`WorldCollector`、`WorldObservations` は NeoForge root から明示的に取り込む。イベント登録と viewer のクラス読み込みは loader ごとに分ける。

依存の版・URL・SHA-256 は [pack-fabric.lock.json](../fixtures/pack-fabric.lock.json) に固定する。EMI は 1.1.24+1.21.1+fabric、TechReborn と RebornCore は 5.11.19。EMI は client のみ配備する。配布 JAR と依存 JAR は harness の記録済み artifact 集合から検証して配備する。

```powershell
pnpm install --frozen-lockfile
node scripts/fetch-fabric-pack.ts
node node_modules/craft-foundry/dist/cli/main.js doctor --json
node node_modules/craft-foundry/dist/cli/main.js inspect --target fabric-1.21.1 --json
node node_modules/craft-foundry/dist/cli/main.js test --target fabric-1.21.1 --suite atlas-fabric-server --json
node node_modules/craft-foundry/dist/cli/main.js test --target fabric-1.21.1 --suite atlas-fabric-client --json
```

Java の絶対パスと `mc-pilot` backend を `harness.local.json` に設定する。ゲーム起動には利用者が Minecraft EULA を承諾した設定が必要。以前に明示的に承諾された設定は再利用できる。各実行は新規の所有セッション・ループバックの予約済みポートを使う。

サーバー Suite は実収集、同一世代の再現性、再読み込み中の公開拒否、削除された必須レシピの診断、正常停止を確認する。共通 datapack の `atlas:added`、`atlas:alternatives` の正規化と監査診断は loader 固有 Mod を除いて比較する。比較対象と semantic hash を `common-fixture.json` に保存する。

EMI Suite は統合ワールドの収集、全登録レシピの取得、Minecraft furnace の設備候補、サーバーとの session/generation 一致と古い token の拒否、再現性、停止を確認する。新規ワールドの実験的設定ダイアログが出た場合は画面・画像を記録し、その既知の読み込みボタンだけを処理する。

EMI の入力・出力・category・workstation・backing recipe は公開 API を使う。完了判定のみ固定版の `EmiReloadManager.isLoaded()` に依存する。この境界は status が loaded で worker が終了したことを確認する。別版の対応は主張しない。remote dedicated viewer と EMI 不在 client の viewer 収集は対象外。

EMI 表示は実行の証明に使わない。chance の独立性は不明、返却容器と OR 候補の対応も未解釈として残す。Fabric の fluid は droplet 単位を保持する。この固定 TechReborn/EMI の組合せでは grinder 表示は登録されないため coverage に unsupported を記録する。raw runtime の grinder レシピは別に保存される。

[TechReborn adapter](../packages/core/src/techreborn.ts) は固定版の `techreborn:grinder` の item/tag 材料、数量、複数出力、基準電力・時間だけを解釈する。RebornCore の `power` は EU/tick、`time` は upgrade 適用前の tick 数。基準総 EU は両者の積。運転時の供給電力・upgrade・中断・実時間は unknown。ほかの TechReborn 機械、custom ingredient、components は opaque。

[同梱定義](../definitions/techreborn-5.11.19-fabric.json) は output inventory の容量・slot access が未取得である条件を補う。元の runtime raw と field history は残す。[実機取得 fixture](../fixtures/techreborn-runtime.json) は固定 JAR の hash と収集 run を記録している。

Loot と worldgen の共通取得は適用後のテーブル・Biome・spawn・generator 関係を保存する。Fabric の任意の Java loot hook は全列挙できないため post pipeline の証明を許さない。有限の観測から不可能・生成率・無限供給を証明しない。
