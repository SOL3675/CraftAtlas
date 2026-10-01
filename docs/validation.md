# Phase 0〜4 の検証記録

対象は Minecraft 1.21.1 / NeoForge 21.1.252 / Java 21、Gradle Wrapper 9.2.1 / ModDevGradle 2.0.148。固定 Pack は Mekanism 10.7.14.79、CraftTweaker 21.0.38、JEI 19.22.1.316 です。配布ファイルの SHA-256 は [pack.lock.json](../fixtures/pack.lock.json)、ツールは [harness.lock.json](../harness.lock.json) に記録しています。

## 実装と確認範囲

| Phase | 実装 | 確認したこと |
| --- | --- | --- |
| 0 | Gradle / harness 接続、固定依存、取得境界 | 対象 classpath / mappings を inspect。明示した distribution JAR と side ごとの依存を実ゲームへ配置 |
| 1 | 原本 JSON / JSONL、レジストリ、タグ、適用後レシピ、世代管理、環境ハッシュ | 専用・統合サーバーの収集。データパックと CraftTweaker の追加・削除・置換。同じ条件の再取得で意味上のハッシュが一致 |
| 2 | SQLite 再構築、検索 CLI、意味上の差分、期待監査 | 再構築した二つの DB の問い合わせが一致。レシピ・数量・タグ・配置条件・未解析原本の差分、改ざん / 未公開取得の拒否 |
| 3 | 任意 JEI、Mekanism enriching、補足定義と競合 / 履歴 | 同じセッション・世代の JEI。独自材料を opaque として保存。装置候補と実行条件を区別。架空設備 fixture で工具・触媒・返却物・構築を検証 |
| 4 | シナリオ、AND / OR 到達分析、設備循環候補、局所 Web UI、process Suite | CLI と UI が同じ分析器を使用。禁止条件と表示フィルターの分離。未知の必須条件は unsupported、評価済み違反は failed |

Loot・Worldgen・自然湧き・サバイバル進行全体は Phase 5、数量スケジュール / 最適化 / コスト積算は Phase 6 の対象です。今回の版では coverage と未知理由を残します。Mekanism は enriching の入出力と数量を解釈し、電力供給は未解析条件、時間・エネルギーは未知コストとして保持します。

## 必須 release 検証

実行日: 2026-10-01。Run: `2026-10-01T08-32-52-454Z-18d33cb9`。

```powershell
pnpm check
pnpm test
pnpm build
pnpm exec mch test --all --profile release --json
pnpm exec mch report --run 2026-10-01T08-32-52-454Z-18d33cb9 --json
```

| Suite | 検出数 | 結果と根拠 |
| --- | --- | --- |
| atlas-server | 4 | snapshot / reload / failure-fixture / stopped が passed。実行時レシピ 2,869 件。再取得ハッシュ一致、世代 1→2、変更差分、削除した必須レシピの診断、正常停止 |
| atlas-client | 3 | integrated / jei / client-stopped が passed。レシピ 2,869 件、JEI 4,395 件。同世代の ID・機械装置候補・未知材料・stale token の拒否、環境 / モデルの再取得一致、正常停止 |
| atlas-offline | 1 | Node 契約テスト 29 件すべて passed。検出 0 件や非ゼロ終了では合格にしない |

Run の `report.json` / `junit.xml`、`artifacts/`、`sessions/neoforge-1.21.1/<suite>/` に原本・SQLite・差分・診断・ゲームログ・結果・evidence を保存しています。`source-files.json` は未追跡ソースのハッシュ、`source.patch` は追跡ファイルの差分です。この検証の未追跡ソース本体も `source-archive/` へ保存しました。マシン固有設定は同意済みのこの環境の `harness.local.json` を使用し、共有設定へ絶対パスを混ぜません。

サーバー baseline は適用後 recipe / tag リソース 4,661 件の環境ハッシュを保存。サーバースレッドの読み取り測定は約 265 ms、heap 使用差分約 18.2 MB でした。GC に影響される単回測定であり、性能保証ではありません。ゲーム側の JSON 書き込みは別スレッド、巨大グラフの一括描画は避け、局所グラフはノード数と深さに上限を設けます。

## 故障・不合格の検証

`2026-10-01T08-35-39-614Z-0578e8fe` の `atlas-negative` は実ゲーム取得後に存在しない必須レシピ / タグを要求し、`atlas.expected-failure` が **failed**、ハーネス全体も **failed** でした。これは意図した不合格です。通常 release の `atlas.failure-fixture` は、実際に reload で除去した `atlas:added` の違反を検出できたことを検証します。

reload 中の保存テストは `craftatlas.testWriteDelayMillis=2000` を検証用 JVM 引数へ設定し、実際の取得開始と reload マーカーを待って競合させます。世代の変わった staged データは failed となり、最終ディレクトリへ公開されません。通常利用の待機は 0 ms です。準備判定は lifecycle / JEI / ファイル完了の実情報で行います。

以前の release Run `2026-10-01T08-19-07-068Z-63ea9ec0` は不合格でした。サーバーの console は reload 完了後に次のコマンドを処理するため検証条件を修正し、JEI が非同期生成する 4 個の設定ファイルの存在を確認してから baseline を取得するよう修正しました。設定ハッシュや表示情報を捨てて差分を隠す方法は使っていません。

Java と TypeScript の canonical JSON の一致は [検証スクリプト](../scripts/check-collector-canonical.ts) で 325 ケースを検証。全 65,536 UTF-16 コード単位をキー・値に含むケース、U+2028 / U+2029、単独サロゲート、指数表記を含みます。

最終レビューで未知の連動制約を reachable / 必須 support 合格へ昇格しない回帰テストと、JEI の表示候補で必須サーバーレシピの存在を満たさない回帰テストを追加しました。runtime 原本の ID と明示した補足定義の追加 ID は引き続き評価できます。

## UI と対応境界

ブラウザーでオフライン fixture の AND / OR グラフ、詳細・根拠・診断・差分を確認し、実取得の 1,757 資源の検索と局所グラフも確認しました。HTTP / CLI の境界・上限・DB インポートは契約テストで検証しています。

JEI は統合サーバーの同じセッション / 世代に限定。専用サーバーへのリモート接続のビューア収集は未対応です。再読み込みで古い JEI 情報になった場合は拒否し、同世代の準備完了または新しい統合セッションを必要とします。サーバーのみの収集には JEI を配置しません。

KubeJS、Mekanism の他の型、任意コードの条件、実 Mod の設備構築・儀式は未検証です。同梱設備定義は版指定した架空 fixture。JEI の曖昧な対応・表示専用情報を、実行可能なサーバーレシピや到達証明に昇格しません。
