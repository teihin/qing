# 内置 imagegen 提示词

生成方式：内置 imagegen；图片见本目录 README。第一张使用 V8-new「我的」「战绩」作为风格参考，第二张使用第一张锁定共用外观，最后定向修正第一张的牌背数量与底牌标线。

## 01 牌局回顾初稿

Use case: ui-mockup / style-transfer.
Redesign the supplied V8-new Chinese mobile card-game UI artwork into a polished in-game right-side full-height "牌局回顾" drawer. Deliver ONE finished portrait screen, 1024x1536, clean full-bleed digital game interface, no phone/device frame, no presentation annotations.
Input images are V8-new STYLE SOURCES only: bright medium blue/cyan lacquer panels, pale champagne/ivory gold outlines and typography, clean restrained rim highlights, clear readable Chinese text. Do not reuse their lobby composition, logos, or content. This new design uses their material and lighting. No 8L logo or any brand text. No thick imperial ornament, dark muddy panels, scanlines, vertical texture stripes, neon overload, casino marketing.
Composition: right drawer anchored to right edge, full height, x=210 to1024 (about80% width). At x=0..210 show only a softly dimmed blurred blue card table edge, establishing an in-game overlay. Drawer left edge thin pale gold border and faint cyan rim. All content stays within drawer. Top and bottom fixed, scrollable middle area. Big typography and generous row spacing.
Top: small left-side outlined mode badge "地九王", large centered title "牌局回顾", circular gold close X top right. Under title, two equal wide segmented tabs at x240..994: "牌局回顾" selected pale champagne gold with navy text; "文字牌谱" unselected clear blue with ivory text. All Chinese sharp and correctly spelled.
Compact information band below tabs: left "奖池  0"; right two color-key markers, lemon-yellow line labelled "底牌", orange-red line labelled "尾飞". Keep card paper white/cool light-gray with pure red hearts/diamonds and true black clubs/spades. Do not tint cards gold.
Main area: six crisp player rows, each approx150px tall, aligned consistent columns. Thin horizontal dividers and subtle blue alternating surfaces; no thick separate glowing boxes. Left column circular avatar, player name, smaller ID; optional tiny "庄" badge only in row1. Middle column FOUR STANDARD PLAYING CARDS in TWO PAIRS (2+2), small gap inside pairs, larger gap between pairs; correct upright proportions around 50x70 at this output, with clear suit and rank; pair type caption under each. Right column large net score, red positive and mint-green negative; reserve smaller secondary text space for the existing optional result details (do not invent totals or earnings metrics).
Use demo rows:
1 name "青山" ID:100001, 庄, cards 7♠ 2♥ / 5♣ 3♦, pair labels "9点" / "8点", score "+360".
2 "听雨" ID:100002, cards 8♠ A♥ / 6♣ 2♦, labels "9点"/"8点", score "+240".
3 "清风" ID:100003, cards 6♠ A♦ / 5♥ 2♣, labels "7点"/"7点", score "−180".
4 "山海" ID:100004, cards 9♥ 8♣ / 7♦ 9♠, labels "7点"/"6点", score "−120".
5 "星河" ID:100005, cards 3♠ 4♥ / 2♣ 4♦, labels "7点"/"6点", score "−200".
6 "云舟" ID:100006, two face-down blue cards only, status "弃牌", score "−100". No made-up revealed hidden cards.
Cards may be compact but should be genuinely readable and never overlap names/scores. On first five rows add tiny lemon lines below first 2 cards and an orange-red line below fourth card, matching legend. Use generic attractive avatar illustrations, not famous people. User IDs much smaller and lower contrast than names. Row1 may receive a soft brighter cyan blue highlight without changing structure.
Fixed bottom separated by a thin gold rule: four small circular navigation buttons with conventional first/previous/next/last icons, and centered "12 / 24" between previous and next. Below or above them an unobtrusive caption "第12局". Do not add playback, sharing, analysis, filter or other new features. No giant footer button. Entire footer and all six rows inside canvas.
Polish: thin bright boundaries, smooth blue gradients, warm ivory labels without yellow cast, regular simplified-Chinese UI font, readable large names and scores, ample breathing room, elegant V8-new visual consistency.

## 02 文字牌谱

Use case: ui-mockup / precise-object-edit.
Create the SECOND TAB STATE of the attached finished V8-new in-game drawer. Output one portrait 1024x1536 interface. Treat attached image as EDIT TARGET: KEEP EXACTLY the left dim blurred card table strip, right full-height drawer position and width, blue material, gold border, title bar with "地九王", centered "牌局回顾", circular X, top segmented tab geometry, info band position, and fixed bottom page controls "第12局", "12 / 24". Match its typography, brightness and clean finish. No logo. No additional floating popup, no phone frame, no explanatory labels.
Change only active tab and scrollable content:
1. Select "文字牌谱" in champagne gold with navy text; unselect "牌局回顾" with the same blue surface and ivory text. Tab labels spelled exactly.
2. Shared compact band below tabs keeps left "奖池  0". Replace card legend on the right with a small restrained outlined "举报" control (conditional report entry illustrated in this design state). No bottom-card legend needed for text.
3. Replace ALL avatars/cards/player result blocks in central area with a precise readable TEXT HAND HISTORY grouped into "第一轮", "第二轮", "第三轮", in order, ALL THREE visible. No avatars, no playing cards and no net-score rows in this view. Wide elegant blue section header bars with thin champagne rule: round name left, "操作" above center action amount column, "剩余钵钵" above right balance column. Three consistent column axes. Names large ivory on left; secondary ID immediately below the name in smaller desaturated light blue. Center has a tiny compact action badge, original natural 49:36 horizontal proportion, followed by the amount on the SAME LINE. Right balance digits right-aligned, large ivory. Body rows transparent blue with delicate horizontal separators only, no enclosing individual rounded cards. Body text approx28-31px, ID approx18px, header32px. Clear simplified Chinese. Use sufficient spacing and no text collision. Do not duplicate amount across columns.
Fit the following exact demo rows into the middle content region between info band and footer, using approximately60px row heights and44px section titles plus spacing:
第一轮:
青山 / ID:100001 | 大 60 | 1,940
听雨 / ID:100002 | 跟 60 | 1,940
清风 / ID:100003 | 跟 60 | 1,940
山海 / ID:100004 | 跟 60 | 1,940
星河 / ID:100005 | 跟 60 | 1,940
云舟 / ID:100006 | 丢 — | 1,900
第二轮:
青山 / ID:100001 | 大 120 | 1,820
听雨 / ID:100002 | 跟 120 | 1,820
清风 / ID:100003 | 跟 120 | 1,820
第三轮:
青山 / ID:100001 | 敲 180 | 1,640
听雨 / ID:100002 | 跟 180 | 1,640
Use muted gold badge for "大", cyan blue badge for "跟", muted blue-gray for "丢", restrained warm coral for "敲", all readable and elegantly restrained. Badge shapes consistent, not oversize. Preserve long amount readability. These are visual sample records, no need explanatory mock-data text within UI.
Fixed footer placement must precisely match input. Make the last row comfortably above footer, can leave modest blue breathing room. No added export/share/replay/filter/search buttons. Entire content complete, no clipping.
Finish: match the supplied V8-new design as the SAME component in a different tab state. Crisp, high-quality digital UI, bright blue/cyan + pale ivory gold, no muddy black, yellow background, repetitive stripe texture or excessive neon.

## 01 牌局回顾局部修正

Use case: precise-object-edit. Edit this supplied finished 1024x1536 V8-new "牌局回顾" drawer with ONLY two local fixes. Keep all layout, colors, table background, avatars, names, IDs, card faces, scores, Chinese text, typography, tab bar, title bar and footer exactly unchanged.
Fix1: in bottom player row "云舟" ID:100006 score -100, display ONLY TWO blue face-down playing cards at the current first-pair positions x494 and564. REMOVE the two right-hand card backs x665 and736, restoring smooth blue background. Center the existing "弃牌" text below the remaining two cards. Do not add cards or reveal faces.
Fix2: in each of the FIRST FIVE player rows, there is already a lemon-yellow underline below the first card. Add an IDENTICAL yellow underline directly below the SECOND card, as the player has two original bottom cards. Retain the orange-red marker under fourth card. Total two yellow markers plus one orange marker per four-card row. Markers thin and clean, do not recolor card paper.
Everything else stays identical, especially original neutral white card paper and correct pure red hearts/diamonds, black clubs/spades. Output one complete corrected image.

