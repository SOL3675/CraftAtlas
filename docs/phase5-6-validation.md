# Phase 5/6 の実装範囲と検証

この記録は Phase 0〜4 の [検証記録](validation.md) に続く。対象は固定 Pack と明示したアダプターの範囲であり、全 Mod の Loot・自然生成・召喚・サバイバル進行を網羅したという宣言ではない。最終 `mch test --all --profile release` は Run `2026-10-01T22-48-40-778Z-4512ecee` で全必須20ケース成功。実ブラウザ描画は両対象の10標本で予算内だった。

## 実装した範囲

| 分野 | 実装 | 対応境界 |
| --- | --- | --- |
| Loot 原本 | 実行時 LootTable codec、Block/Entity の既定対応、参照・条件・関数を保存 | Entity の個体別上書き、Java イベント経路の全列挙はしない |
| Loot 解釈 | 対応済み item/table/tag、定数数量、基本条件・関数を共通処理へ変換 | 未解釈述語・動的数量・連動候補は原本と unknown を残す |
| 後段 Loot | NeoForge の実際の Global Loot Modifier 管理対象を ID と適用順付き codec で取得 | 任意 modifier の Java 実装を汎用的に解釈しない。Fabric の任意 loot hook は未取得境界 |
| Worldgen | 適用後 Biome 生成・spawn、configured/placed Feature、active Dimension generator と possible Biome / generator 別生成設定を取得 | 登録、適用関係、実際の配置、移動可能性は別の事実 |
| 実測 | `observe loot/block/entity/world`、実行条件、試行、出力、manifest/checksum、session/generation を保存 | 有限の現在状態の観測であり、不存在や無限供給を証明しない |
| 進行定義 | 召喚・構造組立・魔法陣・研究 stage・Dimension 解放を補足定義で表す | `atlas_fixture` は架空契約 fixture。実Mod の構造や儀式対応ではない |
| コスト | 明示した選択経路の材料積算、初期設備費 / 反復費用、工具・返却物・単位別既知コスト、限定した確率期待値 | 代替経路の最適化、任意確率過程、実行スケジュール全体の証明はしない |
| 次のターゲット | Fabric 1.21.1、EMI 1.1.24、TechReborn grinder と版限定の同梱補足定義 | REI と未対象の Mod / 機械は未対応。表示根拠を実行の証明にしない |
| 性能 | 実スナップショットの件数・サイズ・収集時間・メモリ・正規化・SQLite検索・局所グラフと予算 | [性能記録](performance.md) の固定条件。ブラウザ描画は別測定 |

原本は `world.json` に分割保存し、既存 manifest と完了マーカーの検証対象に含める。必要な codec が失敗した行は ID/type/error を保持し、必要取得の失敗を complete として隠さない。観測は世代ごとの取得で、reload 後に古い観測を同世代の事実として混在させない。

## 実Mod・実データ・架空 fixture

NeoForge の固定対象は MC 1.21.1 / NeoForge 21.1.252 / Mekanism 10.7.14.79 / CraftTweaker 21.0.38 / JEI 19.22.1.316。Fabric は MC 1.21.1 / Loader 0.16.14 / Fabric API 0.116.17 / TechReborn・RebornCore 5.11.19 / EMI 1.1.24。JAR の取得先・版・ハッシュは [NeoForge lock](../fixtures/pack.lock.json) と [Fabric lock](../fixtures/pack-fabric.lock.json) に固定する。

Mekanism enriching、TechReborn grinder は実Mod のレシピ codec / 固定版 API と実機取得に基づく。TechReborn の `power` と `time` は基準 EU/tick と tick 数を保存し、基準総 EU は積から求める。upgrade、実供給電力、中断、実時間、出力 inventory の容量 / slot access は未知として保持する。これを全機械対応や確定した運転費と呼ばない。

`atlas:probe`、`atlas:probe_bonus`、`atlas:marker_ore`、`atlas:registry_only` は検証用 datapack である。`craftatlas:add_item` は明示的な datapack 設定でだけ有効になる collector の modifier。実ゲームの後段変更と Biome 適用を検証するための既知ルールであり、第三者 Mod の任意 modifier 対応の根拠にはしない。

[fixture-progression.json](../definitions/fixture-progression.json) と `fixtures/definition-progression-*` は `atlas_fixture` version 2 の架空定義である。構造を組み立てた capability、床に描く魔法陣、研究 stage、Dimension access、反復召喚、確率ドロップをモデル化し、AND/OR、条件不足、工具耐久、触媒、返却容器、初期費 / 反復費を契約テストで確認する。Minecraft に実在する Mod やワールド内の構造を操作した検証ではない。`structure_assembly_valid` 等の context の宣言は、実際のブロック配置を検出した事実ではない。定義の `executable` は宣言された条件下のモデル上の処理を表す。

## Loot・Worldgen・観測の制約

Loot は定数 count、単純な item/table/tag 参照、random_chance、killed_by_player、weather、単純な tool item / tag、対応できる all_of / inverted、set_count / limit_count / set_components 等の限定した形式を解釈する。条件付き weighted candidate、複数 weighted rolls、条件付き関数、components や enchantment を含む未対応述語、参照循環 / 深さ制限、任意 Java 実装は unknown / opaque として残す。weight を根拠なく確定した取得確率へ置き換えない。

GLM 配列の順番は実適用順を保持する。NeoForge 管理インスタンスと登録 ID の取得には、inspect した固定版への Mixin accessor / invoker を使う。loader 版が変わった場合は再検証が必要。既知 `craftatlas:add_item` と table ID 条件は解釈できても、その結果だけで break/death event 後の全結果を保証しない。LivingDropsEvent、block drop event、任意の Mod コードは別の未取得経路である。

Worldgen の registered Feature は登録だけでは生成の証明にならない。generator と Biome の適用関係を記録できた Feature も、placement、他コードの条件、既存 chunk、実際の到達可能領域まで確定したわけではない。Mob の spawn weight は一定時間当たりの供給率ではなく、Dimension generator の存在はそこへ旅行・解放できる証明ではない。

観測コマンドは seed、generator、Dimension、位置 / chunk、player、tool、context、試行数、各出力、ゲームルール、時刻 / 天候を取得可能な範囲で保存する。console 実行の player は null。loot の table sampling、block の指定 state/tool、entity の未配置個体の table sampling は、実際の採掘・死亡を実行したテストと区別する。block の `breakPerformed` と entity の `deathPerformed` は false。world は半径0〜1 chunk、最大64高度の現在の chunk を読み、要求した chunk を load/generate し得る。既生成 / 編集済み chunk を pristine generation と認定しない。

有限観測の出力は `observation` の根拠と表示用処理として残す。観測されなかった資源を出現不可能と断定せず、観測量を無限供給率・厳密な確率・spawn rate に外挿しない。表現上の確率と実測頻度は別のデータである。

## 確率コストの制約

[cost.ts](../packages/core/src/cost.ts) は呼び出し側が選んだ非循環の経路を積算する。OR 材料の選択、対象 output、単位、初期在庫、設備 / stage / Dimension、context を入力として扱う。初期組立と繰り返し消費を分け、触媒を消費材料へ足し込まず、工具耐久と返却 seed / container を別に評価する。

確率 output は `expectation` mode と明示的な stationary IID Bernoulli 宣言がある範囲で expected trials / batch variance を計算する。期待値は必ず成功する回数・有限在庫での完了保証ではない。確率の独立性と定常性は観測から自動認定しない。副産物の独立性も明示宣言が必要で、ランダム副産物を別経路の確実な供給へ充当しない。

確率的な上流バッチ丸め、有限在庫への確率需要配分、工具交換の期待回数等に必要な分布がない場合は mean-flow / unknown を残す。各 step の variance は保持しても、共分散情報なしに全材料・総費用の variance を推定しない。未知コストは既知 subtotal と分離し、異なる単位を暗黙に換算しない。時間の合計は処理時間の和であり、並列運転した実経過時間ではない。cost が空であることは電力や時間がゼロという証明にならない。

## 追加しない範囲と判断

交易・釣り・栽培は、現在の固定 Pack の要求から専用経路アダプターの必要性を実証していない。一般の登録済み LootTable は fishing 等を含めて収集するが、それだけで実際の釣り道具・水域・luck 条件、村人の offer / restock、植物の成長・環境・収穫・再植付けをモデル化したとは扱わない。代表 Pack の必須進行で必要になった段階で、版と Mod を固定し、実動作と再供給条件を記録する専用 fixture を追加する。未実装の専用経路を成功扱いしない。

最適化ソルバーは現時点で追加しない。現在の目的はユーザーが選んだ経路の検証可能な積算で、最適化すべき制約・目的関数・完全な供給モデルが未確定だからである。選択経路の cycle を最適な無限生産とみなさない。

MCP 公開は現時点で追加しない。CLI と loopback HTTP に機械可読の検索・診断・局所グラフ・コストがあり、MCP 固有の必要性はまだ確認していない。既存 API の利用状況から具体的な不足が判明した場合に境界と権限を設計する。

専用 harness Driver は現時点で追加しない。既存 process Suite の wrapper が所有ゲームの起動、実準備マーカー、収集、今回の結果 / 証拠、期限、失敗時停止を管理できる。process Driver 自体がゲームの準備や停止を代行するとは仮定しない。必須 suite、期待 ID、未検出・unsupported・0件の判定は維持する。

## 現時点で確認した実行と最終確認

| 個別 Run | suite | 確認内容 |
| --- | --- | --- |
| `2026-10-01T22-17-57-881Z-64a58066` | NeoForge atlas-server、4件 passed | Loot1361、GLM1、Block/Entity対応1392、Biome64、Dimension3、Feature475。再取得の意味ハッシュ一致、reload 世代混在の公開拒否、削除必須レシピ検出、停止 |
| `2026-10-01T22-23-01-440Z-4b0b8522` | NeoForge atlas-world、4件 passed | 通常 noise generator、seed8675309、survival/normal、適用 marker Feature と登録のみの区別、実後段 GLM、4種の条件付き観測 |
| `2026-10-01T22-22-53-826Z-e0fbc799` | Fabric atlas-fabric-server、4件 passed | 固定 distribution / Pack のサーバー取得、3767 recipes、再取得・reload・故障 fixture・停止 |

atlas-world は flat/creative の smoke で代用せず、通常 generator とゲームルールを使用した。`atlas:probe` の10試行は各回 diamond2 + 後段 emerald1、合計20/10を確認。stone/tool の5試行、zombie の10試行、1 chunk の高度0〜31の8192ブロックを観測し、manifest/checksum と同じ session/generation/environment を検証した。これらの件数は指定した fixture / context の結果である。

性能の個別測定・予算・故障注入は [performance.md](performance.md) を参照する。unit / contract tests の成功を実Mod の全機能対応の根拠には使わない。

## 最終 release と再検証

`node node_modules/mc-dev-harness/dist/cli/main.js test --all --profile release --json` の最終 Run は `2026-10-01T22-48-40-778Z-4512ecee`、2026-10-01 22:53:50 UTC に passed。`mch report` の required 状態・検出数・各 case・artifact hash を確認した。

| 対象 | 必須 suite と検出数 | 結果 |
| --- | --- | --- |
| NeoForge | atlas-server 4、atlas-client 3、atlas-offline 1、atlas-world 4 | 全12件 passed |
| Fabric | atlas-fabric-server 4、atlas-fabric-client 3、atlas-offline 1 | 全8件 passed |

配布 JAR は NeoForge SHA-256 `c8c44d22ee5ce5a3399b1c5f06b08265a8e675bc21ac43ee65449da98e471560`（58496 bytes）、Fabric `34b2fc1af7f8778d8da634acbd6cec778e8eb60784cf3e2863738210eb8cc535`（50500 bytes）。JEI は4395、EMI は4984表示レシピを実取得した。表示は実行条件の証明にしない。

最終両 server の `common-fixture.json` は同じ意味と診断を返し、contentHash は `78a5187a17e6e6318d2dbdb7c83dc227cb1c927898bddbb363712d1696f1226e`。loader 固有 Mod を同一 Pack と見なさず、共通 datapack の材料 OR・数量・タグ・確定した不足診断だけを比較した。

最初の全 Run `2026-10-01T22-39-28-493Z-0661ceeb` は NeoForge 統合ワールドの実験的設定確認画面で infrastructure-error と skipped を記録し、全体 failed。保存画面と gui.info を調べ、NeoForge のボタンは GUI 高さ中心+35、Fabric は+17だったため loader ごとの既知画面の位置を修正した。NeoForge だけの Run `2026-10-01T22-45-51-738Z-2c52977f` の3ケース成功後、全必須20ケースを再実行した。最初の失敗を成功へ書き換えていない。

release の offline は両対象で67テスト成功。最後に SQLite `uses` で context/opaque のIDが資源IDに一致しても資源用途へ混入しないよう修正し、equipment/stage/dimension と実材料を保持する68件目の回帰テストを追加した。このオフライン修正後の全68テスト・型検査・TypeScriptビルド・diff whitespace検査は成功。Java・配布 JAR・Pack・ゲーム側の取得には変更がない。最終 core 性能はこの修正後のコードで同じ最終 Run データを再測定し、両対象の全16指標で既存予算を満たした。

Run は tracked source.patch と untracked source-files.json を持つ。54 untracked ファイルの開始時バイトを `source-files/` と `source-archive.json` に照合保存し、後のオフライン修正・文書を含む最終 working tree は `final-source.patch` / `final-source-files/` / `final-source-archive.json` に別保存する。Run の配布 JAR と依存ハッシュ、修正後 unit log、性能入力 / ソースハッシュを併せて再現する。

UI はループバックの実アプリで確率ドロップの期待試行4・分散12、初期組立と反復費、返却容器、副産物、stage/dimension/context 条件の局所グラフを確認した。架空 progression fixture の画像は `.harness/ui-phase56/progression-cost-view.png`。実両 Pack について depth2・100ノード上限、5資源ずつを描画し、DOM構築最大12.4ms、二回のframe待機最大49.9ms、API最大100.4ms、全10標本で予算内だった。GPUの正確なpaint時間や長期p95は主張しない。予算・原値・最終Runの core 再測定は [performance.md](performance.md) を参照する。
