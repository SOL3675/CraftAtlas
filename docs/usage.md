# 使い方

コマンドはリポジトリルートで実行します。Node.js **24**、pnpm **11.19.0** を使用します。Java の収集 Mod をビルド / 実行する場合は Java **21** も必要です。

## 保存済みデータを調べる

```powershell
pnpm install --frozen-lockfile
pnpm fixture
pnpm check
pnpm test
pnpm build
```

`pnpm fixture` は同梱の小規模オフライン fixture を再生成します。実ゲーム取得の代替証拠にはなりません。TypeScript は Node 24 で直接実行でき、ビルド後は `node dist/packages/cli/src/main.js` でも同じ CLI を使えます。

```powershell
pnpm atlas validate --snapshot fixtures/before.json --json
pnpm atlas import --snapshot fixtures/before.json --db .harness/atlas.sqlite --json
pnpm atlas inspect minecraft:dirt --db .harness/atlas.sqlite --json
pnpm atlas sources minecraft:diamond --db .harness/atlas.sqlite --limit 10 --offset 0 --json
pnpm atlas uses minecraft:dirt --db .harness/atlas.sqlite --json
pnpm atlas coverage --db .harness/atlas.sqlite --json
pnpm atlas explain minecraft:diamond --snapshot fixtures/before.json --scenario fixtures/scenario.json --depth 3 --json
pnpm atlas audit --snapshot fixtures/before.json --expectations fixtures/expectations.json --json
pnpm atlas diff --before fixtures/before.json --after fixtures/after.json --json
```

`fixtures/expectations.json` は実ゲームのデータパック / CraftTweaker fixture 向けです。小規模 `before.json` に対する上記 `audit` は、必須 ID がない診断を確認する例です。期待条件の違反でも `audit` の問い合わせ自体は終了コード `0` で完了します。診断の全件数・ページ・status を評価してください。

入力は `--snapshot` の単一 JSON / 完了済み取得ディレクトリ、`--model` の正規化モデル JSON、または `--db` の SQLite です。`import` は `--snapshot` / `--model` と出力先 `--db` を指定し、DB を丸ごと再構築します。`--snapshot-id` は DB 内の対象 ID を選びます。CLI は未知のオプション、欠けた引数、上限外のページ・深さを拒否します。

`--definitions` は繰り返し指定できます。対象 MC / ローダーを原本から確定するため、定義適用には `--snapshot` が必要です。

```powershell
pnpm atlas explain atlas_fixture:crystal --snapshot fixtures/definition-equipment-snapshot.json --definitions definitions/fixture-equipment.json --scenario fixtures/definition-equipment-scenario.json --json
```

この設備は架空のオフライン fixture です。設置能力、工具の耐久消費、触媒、返却容器、初期設備費と反復処理の分離をテストし、実 Mod の対応済み設備としては扱いません。

## ローカル UI

```powershell
pnpm atlas serve --snapshot fixtures/after.json --before fixtures/before.json --scenario fixtures/scenario.json --expectations fixtures/expectations.json
```

既定 URL は [http://127.0.0.1:4317](http://127.0.0.1:4317)。`--port` で変更でき、`--host` は `127.0.0.1`、`localhost`、`::1` のみです。Ctrl+C で終了します。UI は読み取り専用です。

アイテム名 / ID で検索し、資源ノードを選択して入手経路 / 用途を展開します。処理ノードを選ぶと材料スロット、数量、出力確率、返却物、設備、コスト、フィールド別根拠、未知情報を確認できます。グラフの深さやノード数で表示を打ち切った場合は明示します。

診断は CLI と同じ `audit`、到達分析は同じ `analyze` を使用します。`--expectations` 未指定ならモデルの診断を表示します。`--scenario` 未指定では到達分析を無効にし、`--before` 未指定では差分用データがないことを表示します。Mod フィルターは表示専用です。分析経路を禁止したい場合はシナリオ JSON の `forbiddenProcesses` / `allowedTypes` を変更し、UI を再起動してください。

## 収集 Mod と固定 Pack

固定環境は [pack.lock.json](../fixtures/pack.lock.json) と [Gradle 設定](../mods/collector/gradle.properties) で管理します。

| 依存 | 固定版 |
| --- | --- |
| Minecraft / NeoForge | 1.21.1 / 21.1.252 |
| Java / Gradle Wrapper | 21 / 9.2.1、Wrapper に配布 SHA-256 を固定 |
| JEI | 19.22.1.316、任意のクライアント依存 |
| CraftTweaker | 21.0.38 |
| Mekanism | 10.7.14.79 配布ファイル、実行時 Mod 版は 10.7.14 |

```powershell
node scripts/fetch-pack.ts
```

固定 URL から `.harness/pack/` へ取得し、保存前に SHA-256 を照合します。Gradle の `copyRuntimeDependencies` でもハッシュを確認し、harness export に配布 JAR と各依存の配置 side を記録します。

ゲーム内または専用サーバーのコンソールで実行します。

```text
craftatlas status
craftatlas dump baseline
reload
craftatlas dump changed
```

ゲーム内では先頭に `/` を付けます。サーバーコマンドは権限レベル 2 が必要です。起動・再読み込みの完了を確認し、`CRAFTATLAS COMPLETE` と `craftatlas/<label>/completion.json` が揃った取得ディレクトリを読み込んでください。取得開始メッセージだけを完了として扱いません。同名の既存取得を上書きしないため、新しい label を使ってください。

JEI を導入した統合サーバーでは、JEI runtime の準備完了後に `/craftatlas-client dump integrated` を使用します。専用サーバーへ接続したリモートクライアントでの JEI 収集は未対応です。古いセッション・取得世代のキャッシュを統合せず拒否します。再読み込み後に JEI の同じ取得世代の準備が完了していなければ、サーバーのみの dump か新しい統合セッションを使用してください。

## ハーネスの設定と実ゲーム検証

共有設定は [harness.config.json](../harness.config.json)、固定ツールは [harness.lock.json](../harness.lock.json) です。マシン固有の Java / ツール / backend 絶対パスは git 管理対象外の `harness.local.json` に設定します。最小例は次のとおりです。

```json
{
  "schemaVersion": 1,
  "java": { "java21": "C:/absolute/path/to/jdk-21" },
  "tools": {
    "neoforge-server-1.21.1": "C:/absolute/path/to/neoforge-21.1.252-installer.jar"
  },
  "timeouts": { "build": 900000, "start": 240000, "test": 600000, "stop": 20000 },
  "eulaAccepted": false
}
```

`eulaAccepted: true` は利用者が Minecraft EULA に既に明示的に同意した場合だけ設定します。他の利用者やマシンの同意状態をコピーして同意したことにしません。上の例の `false` のままでは EULA 必須 Suite は実行されません。Java home は `bin/java` を含むインストールルートを指定します。固定ツールは lock の SHA-256 と一致する必要があります。

クライアント Suite には固定した mc-pilot backend と NeoForge helper も必要です。導入済みハーネスの [設定契約](../node_modules/mc-dev-harness/docs/configuration.md) と [ツール導入](../node_modules/mc-dev-harness/docs/tools.md) を確認します。backend を新規導入するコマンドは次のとおりです。

```powershell
node node_modules/mc-dev-harness/dist/cli/main.js tools install mc-pilot --project .
```

このハーネス版の backend installer は内部で `npm ci` を使います。npm が PATH にない場合は `--npm-command` に npm 実行ファイルの絶対パスを指定するか、管理メタデータと固定ハッシュを検証できる導入済み backend を再利用します。プロジェクト本体の依存管理は pnpm です。

installer は `harness.local.json` を編集しません。返された `backendRoot` を `backends.mc-pilot` に設定してください。NeoForge helper は lock の固定バイトを自動取得できます。取得済みのものを使う場合は `tools.mct-helper-neoforge-1.21.1` にその絶対パスを設定します。必要なら `assetCaches["1.21.1"]` に検証済みの `assets/objects` を設定できます。未指定ではクライアントが必要な資源を取得します。client wrapper は今回の隔離セッションで生成したワールドを開き、配布 JAR・JEI・Pack・helper をハッシュで確認して起動します。

```powershell
node node_modules/mc-dev-harness/dist/cli/main.js targets --json
node node_modules/mc-dev-harness/dist/cli/main.js doctor --json
node node_modules/mc-dev-harness/dist/cli/main.js inspect --target neoforge-1.21.1 --json
node node_modules/mc-dev-harness/dist/cli/main.js build --target neoforge-1.21.1 --json
node node_modules/mc-dev-harness/dist/cli/main.js test --target neoforge-1.21.1 --suite atlas-offline --json
node node_modules/mc-dev-harness/dist/cli/main.js test --target neoforge-1.21.1 --suite atlas-server --json
node node_modules/mc-dev-harness/dist/cli/main.js test --target neoforge-1.21.1 --suite atlas-client --json
node node_modules/mc-dev-harness/dist/cli/main.js test --all --profile release --json
```

release は NeoForge の `atlas-server`、`atlas-client`、`atlas-offline`、`atlas-world` と、Fabric の `atlas-fabric-server`、`atlas-fabric-client`、`atlas-offline` をすべて評価します。クライアントの準備がない環境でサーバーの成功だけを release の成功とは扱いません。結果・取得原本・配布成果物・ログ・診断・差分は `.harness/runs/<run-id>/` に保存します。

意図的な不合格を確認する `atlas-negative` は release の必須 Suite から分離しています。

```powershell
node node_modules/mc-dev-harness/dist/cli/main.js test --target neoforge-1.21.1 --suite atlas-negative --json
node node_modules/mc-dev-harness/dist/cli/main.js report --run <run-id> --json
```

`atlas-negative` は実ゲームの必須レシピ / タグ不足を `failed` として出力し、ハーネスの実行結果も不合格になることを期待します。一方、通常の `atlas-server` の `atlas.failure-fixture` は、変更後の実ゲームで違反を検出できたことをテストして `passed` と記録します。

固定 datapack はレシピ・タグ変更に加え、確定 Loot、適用済み NeoForge Loot modifier、組み込み済み/登録のみの Feature を検証します。`atlas-world` は seed 8675309、通常生成、survival、normal difficulty で観測します。自然資源の継続供給、サバイバル進行全体、機械の動作電力や所要時間を検証した Pack ではありません。

## Loot / Worldgen と有限観測

通常の dump に `world.json` が加わります。原本・適用済み設定・未解釈コード・観測は別の根拠として保存します。登録された Feature だけで実際の生成を断定しません。Fabric の任意 loot hook は全列挙できないため、post pipeline は unknown です。

```text
craftatlas observe loot probe atlas:probe 10
craftatlas observe block stone minecraft:stone minecraft:diamond_pickaxe 5
craftatlas observe entity zombie minecraft:zombie 10
craftatlas observe world chunk 0 0 31
craftatlas dump after-observations
```

`observe block/entity` は Loot context のサンプリングで、実破壊/死亡イベントではありません。アイテムをプレイヤーへ付与しません。`observe world` は現在位置の指定 chunk 半径と高さを読み、新規 chunk を生成する場合があります。半径は0〜1、高さ範囲は最大64、Loot 試行は1〜1000です。

`craftatlas/observations/<label>/` に条件・試行結果・manifest・completion を保存します。seed、生成器、dimension、chunk、player、biome、difficulty、時刻、weather、game rules、session/generation/environment hash を残します。dump には同じ取得世代の観測だけを添付し、reload 後は引き継ぎません。有限観測の未出現を不存在、見つかった量を定常供給率へ変換しません。

## 選択経路の材料・コスト

```powershell
pnpm atlas cost --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json --limit 30 --json
pnpm atlas serve --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json
```

`cost` は scenario と [計算プラン](../schemas/cost-request.schema.json) が必須です。routes で資源の生成処理と出力 index、selections で OR スロットの材料、target で目標数量・単位を選びます。UI の「材料・コスト」で JSON を編集し計算できます。候補から作る初期プランはユーザーが確認する選択案で、最適経路ではありません。

初期設備・stage/dimension 解放は setup、反復材料と処理費は recurring に分けます。返却物・決定的副産物を再利用し、触媒は必要容量、工具は残り耐久と寿命から計上します。単位の異なるコストは合算しません。未知値を含む総額は null、取得済み小計は knownSubtotal です。

確率出力の計算は mode=expectation と処理別の iid-bernoulli 宣言が必要です。独立試行で必要成功回数 n、確率 p の期待試行数 n/p と分散 n(1-p)/p² を計算します。ランダム副産物を上流材料へ自動充当しません。有限在庫・上流のバッチ丸め・ランダム耐久交換に完全分布が必要なら mean-flow と unknown を返します。complete/unknown/invalid は result.status で確認し、CLI の終了コード0を計算の完全性と解釈しません。

Fabric の導入・固有アダプターは [Fabric 対応表](fabric.md)、測定と再現コマンドは [性能記録](performance.md) を参照してください。
