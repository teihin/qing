# 登录完整背景素材

正式背景源为 `continuous-background-source.png`，通过内置 imagegen 编辑生成。消费路径为 `assets/resources/V7/casino_bg.png`（941×2232），由 Swift 一次等比归一化；不再将旧原图与上下补片拼合。

`seam-repair-input.png` 是存在窗框断接、底部双桌沿的修复输入；`seam-repaired-source.png` 是修好几何关系的中间稿，含 UI，仅作下一步清理输入，不能用作正式背景。最终底图已去掉盾牌、两行输入、链接和登录按钮；正式控件保留 V8-new 定稿原像素并按轮廓透明化，位置不变。

最终运行截图见 [长屏](qa/login-iphone-x.png) 和 [普通屏](qa/login-iphone-6.png)。实现及检查见 [修复交接](../../docs/memory/handoffs/2026-09-10-login-overlap-fix.md)。

## 修复几何的完整提示词

使用内置 imagegen；编辑输入为 `seam-repair-input.png`，输出保存为 `seam-repaired-source.png`。

```text
Use case: precise-object-edit.
Asset: final long mobile login background. Edit the supplied 941x2232 image; keep this exact full portrait canvas, do not crop.
Primary request: repair ONLY two visibly broken background geometry areas so this looks like one coherent continuous scene, not a collage.
1) UPPER BACKGROUND: in the top 0..480 pixels, the window mullions near x430..630 terminate abruptly / change alignment near y280. Reconstruct them as physically continuous straight vertical window bars running from the top edge downward into the existing original bars and foliage. Use one consistent perspective, continuous blue reflections and gold light strips. Keep sky and palms natural and seamless.
2) LOWER BACKGROUND: in y1700..2232, the blue leather poker-table rail is duplicated into two disconnected curved fragments. Reconstruct ONE single continuous blue leather + gold inset rail in a smooth perspective curve, connected to the rail directly underneath the existing playing cards; it should flow naturally to the lower-left edge with NO second rail below it. Fill the removed duplicate fragment with matching navy table cloth / naturally continuous scene. Preserve the existing cards and chip stack and their positions.
CRITICAL INVARIANTS: do not alter any pixel in the middle y480..1700; keep the 8L shield, all text, two input fields, login button, links, casino lettering, bar, furniture, chips, playing cards at exactly the same locations and sizes. No UI redesign or added objects. Only repair the two outer background zones. No blurred blend strips, repeated edge pixels, ghost geometry, new curved rail, seams, black bands, pointers, red annotations or watermark. Return the full edited image at the same 941:2232 aspect ratio.
```

## 提取连续底图的最终提示词

使用内置 imagegen；编辑输入为 `seam-repaired-source.png`，最终输出保存为 `continuous-background-source.png`。

```text
Use case: precise-object-edit / background plate extraction.
The provided image is the repaired complete 941:2232 portrait scene. Produce its CLEAN BACKGROUND PLATE for the real game.
Remove only the overlaid central shield (8L, BL POKER, POKER GAME), BOTH blue input fields including icons and text, the two Chinese link labels, and the blue login button including its label. Inpaint behind the removed shield as a natural continuation of the lounge, bar, window/foliage and the far blue table rail; behind removed controls continue the blue patterned poker table cloth.
Preserve EXACTLY the entire rest of the scene: uninterrupted straight vertical blue/gold window columns, sky, palms, CASINO sign, bar bottles/stools, left lounge chairs and lamp, all chip stacks and playing cards, and the SINGLE continuous lower blue leather rail with golden inset. Keep their positions, dimensions, perspective, colors, brightness and full portrait canvas. Do not crop or zoom. The lower rail must stay ONE clean coherent smooth curve, no duplication or faded fragments. This is a background-only plate; no shield, no form, no UI boxes, no Chinese writing, no 8L branding, no pointer, no red annotation. Do not redesign the background.
```

