# 性能測定と予算

2026-10-02 JST に、固定 Pack の実サーバー取得結果をオフラインで測定した。両ターゲットとも必須4ケースが passed の Run を入力とし、途中取得・fixture の代替・「最新 Run」の自動選択は使わない。予算の対象はこの固定構成と現在の正規化器であり、Minecraft 全 Mod の性能保証ではない。

`scripts/benchmark.ts` はスナップショットの manifest/checksum/意味ハッシュ、完了状態、取得件数、Run の suite/case 状態、記録済み配布 JAR と実配置 JAR の SHA-256 を検証する。`fixtures/performance-budgets.json` の全指標について min/max を評価し、予算超過・必須指標欠落・空データは `status: failed` と終了コード1になる。計測試行数は固定され、0へ減らすオプションはない。出力の上書きも拒否する。

## 入力と証拠

NeoForge 1.21.1 / 21.1.252 は Mekanism 10.7.14、CraftTweaker 21.0.38 を含む。Fabric 1.21.1 / Loader 0.16.14 は Tech Reborn / Reborn Core 5.11.19 を含む。異なる Pack の比較なので、速度差を Loader 自体の差と解釈しない。サーバー計測に JEI / EMI の表示データは含まれない。

| 対象 | 実ゲーム Run | collector JAR SHA-256 |
| --- | --- | --- |
| NeoForge | `2026-10-01T22-17-57-881Z-64a58066` | `d4d01e5cd436a8aa24dcce3d1c921b98a45fb6ea919615a6c27558610ad629ae` |
| Fabric | `2026-10-01T22-22-53-826Z-e0fbc799` | `45f3a9243b9070477512e743ddef50a5711b0c2324d1db62d6acfb9cb6ac40ca` |

各 snapshot と必須 measurements は以下のディレクトリにある。

- NeoForge: `.harness/runs/2026-10-01T22-17-57-881Z-64a58066/sessions/neoforge-1.21.1/atlas-server/game/craftatlas/baseline/` の `manifest.json` / `measurements.json`。
- Fabric: `.harness/runs/2026-10-01T22-22-53-826Z-e0fbc799/sessions/fabric-1.21.1/atlas-fabric-server/game/craftatlas/baseline/` の `manifest.json` / `measurements.json`。
- 評価証拠: `.harness/performance/2026-10-01-neo-02/performance.json`、`.harness/performance/2026-10-01-fabric-02/performance.json`。同じディレクトリに DB、取得時 manifest/measurements のコピー、評価に使った budget のコピーを保存する。
- 予算超過の故障注入: `.harness/performance/2026-10-01-budget-failure/performance.json`。capture 上限を 0.01ms にした入力で、実測 630.989ms を失敗判定し終了コード1を確認した。
- 必須 budget 指標欠落: `.harness/performance/2026-10-01-missing-metric/performance.json`。graph 指標の設定を削除し、全指標の明示指定が必要という失敗と終了コード1を確認した。

証拠 JSON には入力絶対パス、Run/manifest/measurements/budget/JAR のハッシュ、正規化器・DB・グラフ等のソースハッシュ、各試行の所要時間と件数、SQL の実行計画、各指標の予算判定を残す。`.harness` の実行証拠は Git 対象外なので、リリース証拠を配布する場合は Run と性能出力を併せて保存する。

再測定では出力先を新しくする。Windows PowerShell の例:

```powershell
node scripts/benchmark.ts --target neoforge-1.21.1 --run 2026-10-01T22-17-57-881Z-64a58066 --snapshot .harness/runs/2026-10-01T22-17-57-881Z-64a58066/sessions/neoforge-1.21.1/atlas-server/game/craftatlas/baseline --measurements .harness/runs/2026-10-01T22-17-57-881Z-64a58066/sessions/neoforge-1.21.1/atlas-server/game/craftatlas/baseline/measurements.json --output .harness/performance/neo-new
node scripts/benchmark.ts --target fabric-1.21.1 --run 2026-10-01T22-22-53-826Z-e0fbc799 --snapshot .harness/runs/2026-10-01T22-22-53-826Z-e0fbc799/sessions/fabric-1.21.1/atlas-fabric-server/game/craftatlas/baseline --measurements .harness/runs/2026-10-01T22-22-53-826Z-e0fbc799/sessions/fabric-1.21.1/atlas-fabric-server/game/craftatlas/baseline/measurements.json --output .harness/performance/fabric-new
```

## 測定条件

オフライン測定ホストは Windows 10.0.26200 x64、AMD Ryzen 9 7950X3D、32論理CPU、約95GiB RAM、Node v24.19.0。実ゲーム Run のハーネス Node 情報も別に Run に保存されている。ホストは排他的に確保しておらず、別の実ゲーム検証が動作する時間帯の観測である。CPU/ディスクの競合、OSキャッシュ、JIT、GCの変動を含む。NeoForgeとFabricのベンチマーク自体は順番に実行した。

- 取得時間と Java heap delta は実ゲームの `measurements.json` に記録済みの一回の値を読む。ディスク書き込みやハーネスの故障注入待機を含む時間ではない。
- JSON bytes は manifest に記載された全 dataset の実ファイルサイズ合計。manifest、完了マーカー、measurements は含めない。
- スナップショットの検証読み込み1回、正規化3回、SQLite新規構築1回を測る。正規化の3回で意味ハッシュ一致も確認する。最初の正規化を捨てず記録する。
- SQLite の `search`、`sources`、`uses` を各20回。iron_ingot、diamond、oak_log、cobblestone、redstone を循環し、limit50、offset0。各キー1回の事前問い合わせを時間集計から除く。実製品 API の件数 COUNT、ページ取得、JSON decode を含む。
- `sources` / `uses` は output_lookup / input_lookup / requirement_lookup の利用を実行計画で確認する。`search` の部分文字列 LIKE は snapshot の索引で範囲を選んだ後の走査であり、全文検索索引の性能とは呼ばない。
- 局所グラフを10回、同じ5資源、direction=both、depth2、上限200ノードで生成する。ノード上限と辺の参照整合性を検証し、truncated を各試行に保存する。NeoForge の実測グラフはすべて200ノードに達し、420〜793辺を含んだ。
- p50/p95 は nearest rank。正規化3回・グラフ10回の p95 は最大値なので、長期の百分位SLOを推定したものではない。
- Node RSS は各工程のサンプル最大値と `process.resourceUsage().maxRSS` の大きい方を使用し、同プロセスの読み込み・正規化・DB構築・検索・グラフを含む。強制GCは行わない。
- Java heap delta は GC で負になることがあり、保持メモリや総割当量ではない。署名付き原値を保存し、上限評価のみ負値を0へ丸める。未測定値と0を同一視しない。

## 個別 Run の実測履歴と予算

時間は ms、サイズは bytes。resources / recipes は raw snapshot の取得件数、processes / evidence は正規化モデルの件数である。正規化時に補う biome・dimension・文脈等の資源は raw registry 件数に含めない。値は `*-02` の測定結果で、初回 `*-01` の変動も予算設定時に確認した。

| 指標 | NeoForge 実測 | Fabric 実測 | 上限 NeoForge / Fabric |
| --- | ---: | ---: | ---: |
| resources / recipes | 3149 / 2869 | 2052 / 3767 | 20000 / 10000件（両対象） |
| processes / evidence | 4859 / 6170 | 9239 / 7252 | 20000 / 30000件（両対象） |
| JSON dataset bytes | 4,425,359 | 4,399,643 | 16,000,000 / 16,000,000 |
| SQLite bytes | 41,672,704 | 81,649,664 | 67,108,864 / 134,217,728 |
| 実ゲーム capture | 630.989 | 747.804 | 2000 / 2000 |
| capture heap delta bytes | 127,071,840 | 99,636,960 | 536,870,912 / 536,870,912 |
| Node peak RSS bytes | 396,115,968 | 571,846,656 | 1,073,741,824 / 1,073,741,824 |
| 検証読み込み | 127.042 | 163.675 | 750 / 750 |
| 正規化 p50 / p95 | 202.337 / 237.261 | 355.500 / 464.752 | p95 1500 / 1500 |
| DB構築 | 924.353 | 1896.342 | 6000 / 6000 |
| search p50 / p95 | 1.179 / 1.286 | 1.860 / 3.204 | p95 10 / 10 |
| sources p50 / p95 | 3.159 / 3.704 | 7.552 / 10.045 | p95 50 / 50 |
| uses p50 / p95 | 6.224 / 7.032 | 15.669 / 20.105 | p95 50 / 50 |
| 局所グラフ p50 / p95 | 65.158 / 88.267 | 104.627 / 135.810 | p95 500 / 500 |

両対象は全予算を満たした。DB上限は各実測の約1.6倍、Node RSS は最大実測の約1.9倍、取得時間は約2.7倍を確保した。正規化・DB構築・グラフは遅い対象の約3倍以上、queries は最も遅い uses の約2.5倍を上限とした。小標本の環境変動を許容しつつ、大幅な退行を検出する初期予算である。件数とサイズにも最低値を設定して、空または大幅に縮小した取得が性能改善として合格しないようにする。最低値は固定Packに限定した粗い完全性ガードであり、意味上の取得・必須期待条件の検証は従来のハーネスケースを維持する。

現状では core の速度変更は必要なかった。取得情報・原本・不明条件・必須検証を削って予算を満たす処理は追加していない。データ増加、アルゴリズム変更、ホスト変更時は記録済み実データを使って再測定し、予算変更と根拠を一緒にレビューする。

局所グラフ生成時間は Node 内のデータ構築の指標で、ブラウザでの DOM 作成・paint・フレーム遅延は含まない。UI描画の実ブラウザ測定は別の受け入れ証拠として扱う。

## 実ブラウザの局所グラフ測定

In-App Browser で loopback HTTP の実アプリを開き、NeoForge / Fabric の各5資源（diamond、iron_ingot、oak_log、cobblestone、redstone）を表示した。depth2、ノード上限100で、全10標本に API・DOM・frame の値とノード / 辺数を保存した。予算は [ui-performance-budgets.json](../fixtures/ui-performance-budgets.json)、判定と入力 Run / UI ソースハッシュは `.harness/ui-phase56/performance.json`、表示画像は同ディレクトリの `neoforge-graph.png` / `fabric-graph.png` にある。

入力 Run は `2026-10-01T22-39-28-493Z-0661ceeb`。この Run の両 server suite は passed であるが、NeoForge client のワールド読み込みダイアログ処理で全 release は failed だった。今回の描画計測は完成した server snapshot を使う独立した評価であり、この Run 全体を release 合格へ昇格しない。後続の最終全 release と core 再測定は次節に記録する。描画計測の入力 Run は引き続きこの初回 Run として区別する。

| 指標 | 全10標本の最大値 | 予算上限 | 判定 |
| --- | ---: | ---: | --- |
| API応答・データ読み込み | 100.4ms | 1500ms | passed |
| DOM構築 | 12.4ms | 100ms | passed |
| DOM構築後の二回の animation frame 待機 | 49.9ms | 250ms | passed |

`apiMs` は graph 関数のリクエスト準備開始から response の JSON を取得し終えるまで、`domBuildMs` はデータ取得完了からグラフ DOM を組み立て終えるまでの `performance.now()` 差を使う。`frameReadyMs` はそこから二回の `requestAnimationFrame` callback 到達までの待機時間である。GPU の正確な paint / raster / composite 時間、継続スクロール時の FPS、入力遅延、長時間の安定性を測ったものではない。ブラウザのスケジューリング、refresh interval、他処理の影響を含む。

標本は各資源一回で、長期 p95 を推定していない。実表示は NeoForge 43〜100ノード / 50〜203辺、Fabric 24〜100ノード / 24〜214辺で、全標本にデータがありノード上限を守った。100ノードの局所表示と部分取得の予算であり、全グラフ一括描画の性能保証ではない。Node 内ベンチマークは上限200なので、その時間と単純に比較しない。UI の予算は固定した局所表示の大幅な退行を検知する別の guard として保持し、core の性能予算は変更していない。

## 最終 release の成果物と最新 core の再測定

最終全 release Run `2026-10-01T22-48-40-778Z-4512ecee` の `report.json` は passed。NeoForge の必須12ケース、Fabric の必須8ケースが検出され、すべて passed だった。以下はこの Run の両 server baseline を、最新 core で順番に再測定した結果である。既存予算は変更していない。

`uses` の要求参照を equipment / stage / dimension に限定した最終 DB 修正後のコードで測定した。benchmark の EXPLAIN QUERY PLAN も同じ kind 条件へ合わせ、実 API の問い合わせと実行計画を一致させた。両測定の `db.ts` SHA-256 は `76c9c24b2b7a42487c64f56ec50453e7bf4b5325bd4870888a4819132cdc9c5f`。ゲーム由来の capture 値は最終 Run の measurements の値であり、オフライン再測定で作り直した値ではない。

| 対象 | 最終 collector 配布 / 実配置 JAR SHA-256 | 性能証拠 |
| --- | --- | --- |
| NeoForge | `c8c44d22ee5ce5a3399b1c5f06b08265a8e675bc21ac43ee65449da98e471560` | `.harness/performance/phase56-final-neo/performance.json` |
| Fabric | `34b2fc1af7f8778d8da634acbd6cec778e8eb60784cf3e2863738210eb8cc535` | `.harness/performance/phase56-final-fabric/performance.json` |

入力 snapshot / measurements はそれぞれ `.harness/runs/2026-10-01T22-48-40-778Z-4512ecee/sessions/neoforge-1.21.1/atlas-server/game/craftatlas/baseline/` と `.harness/runs/2026-10-01T22-48-40-778Z-4512ecee/sessions/fabric-1.21.1/atlas-fabric-server/game/craftatlas/baseline/`。各性能出力ディレクトリに SQLite、入力 manifest、collector measurements、評価時 budget のコピーも保存した。

| 指標 | 最終 NeoForge | 最終 Fabric | 上限 NeoForge / Fabric |
| --- | ---: | ---: | ---: |
| resources / recipes | 3149 / 2869 | 2052 / 3767 | 20000 / 10000件（両対象） |
| processes / evidence | 4859 / 6170 | 9239 / 7252 | 20000 / 30000件（両対象） |
| JSON dataset bytes | 4,425,359 | 4,399,643 | 16,000,000 / 16,000,000 |
| SQLite bytes | 41,672,704 | 81,657,856 | 67,108,864 / 134,217,728 |
| 実ゲーム capture | 663.375ms | 684.819ms | 2000 / 2000ms |
| capture heap delta bytes（署名付き原値） | 121,845,976 | -51,240,416 | 上限評価 536,870,912 / 536,870,912 |
| Node peak RSS bytes | 376,274,944 | 567,963,648 | 1,073,741,824 / 1,073,741,824 |
| 検証読み込み | 124.771ms | 122.643ms | 750 / 750ms |
| 正規化 p50 / p95 | 202.984 / 227.372ms | 384.708 / 412.992ms | p95 1500 / 1500ms |
| DB構築 | 1111.671ms | 1515.341ms | 6000 / 6000ms |
| search p50 / p95 | 1.532 / 2.009ms | 1.383 / 1.547ms | p95 10 / 10ms |
| sources p50 / p95 | 3.225 / 3.931ms | 6.705 / 8.092ms | p95 50 / 50ms |
| uses p50 / p95 | 6.369 / 6.754ms | 12.694 / 13.602ms | p95 50 / 50ms |
| 局所グラフ p50 / p95 | 57.541 / 69.468ms | 110.568 / 119.758ms | p95 500 / 500ms |

両ターゲットの全16指標が同じ min/max 予算で passed。Fabric の負の heap delta は収集区間の GC 等の影響を含む既知の測定値であり、「割当0」「保持メモリ0」を意味しない。署名付き原値を保存したまま、上限評価値のみ0となっている。旧個別 Run と UI 計測は履歴として残し、最終 JAR の性能証拠と混同しない。
