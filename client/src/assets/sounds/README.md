# 소리 파일

게임 소리를 여기에 넣는다. **무엇을 어떤 이름으로 넣을지는 [`docs/SOUNDS.md`](../../../../docs/SOUNDS.md)에 모두 있다.**

- 이름 그대로 넣는다: `bgm/lobby.mp3`, `bgm/game.mp3`, `attack/pikeman.mp3` …, `construction.mp3`, `complete.mp3`, `alarm.mp3`
- (선택) 같은 소리를 여러 개 넣으려면 `_1`, `_2` …: `attack/pikeman_1.mp3`, `attack/pikeman_2.mp3`
- 이름은 영어 소문자·숫자·`_`만, 형식은 `.mp3`
- 다 넣었는지 확인: `npm run sounds:check -w client`

파일을 넣으면 게임이 알아서 쓴다 (다시 빌드하면 된다. 개발 서버는 새로 고침만 하면 된다).
