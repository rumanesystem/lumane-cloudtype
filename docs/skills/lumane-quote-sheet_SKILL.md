---
name: lumane-quote-sheet
description: "상담이 완료된 후 수집된 고객 정보와 견적 내용을 케이트블랑 드레스룸 견적서 양식에 자동으로 채워 PDF 파일로 생성할 때 반드시 사용. '견적서 만들어줘', '견적서 작성해줘', '견적 파일로 뽑아줘', '양식 채워줘', '견적서 뽑아줘' 등의 요청이 오면 이 스킬을 사용. 상담이 끝난 후 고객 정보와 견적 내용이 대화에 있을 때 자동으로 견적서 PDF 파일을 생성한다."
---

# 케이트블랑 드레스룸 견적서 생성 스킬

상담 내용을 바탕으로 케이트블랑 드레스룸 견적서를 원본 양식 디자인 그대로 생성한다.

---

## 환경 감지 및 모드 선택

먼저 현재 환경을 파악한다:
- **Cowork 환경** (Bash 도구 사용 가능): → PDF 모드로 실행
- **채팅 환경** (Bash 도구 없음): → HTML 모드로 실행

---

## 1단계: 대화에서 데이터 추출

아래 항목들을 현재 대화 맥락에서 추출한다. 없는 항목은 빈 문자열("")로 처리한다.

| 변수명 | 설명 |
|--------|------|
| `customer_name` | 고객 성함 |
| `customer_phone` | 전화번호 |
| `customer_address` | 주소 |
| `quote_amount` | 견적 금액 (예: "839,000원") |
| `payment_method` | 결제방식 |
| `shelf_color` | 선반 색상 |
| `frame_color` | 프레임 색상 |
| `ceiling_height` | 천장 높이 |
| `curtain_box` | 커튼박스 유무 및 높이 |
| `structure_detail` | 치수 및 구조 (예: "309*110 ㄱ자") |
| `opt_drawer2` | 2단 서랍 |
| `opt_drawer3` | 3단 서랍 |
| `opt_pillar` | 기둥추가 |
| `opt_shelf5` | 5단선반 |
| `delivery_cost` | 배송비 |
| `notes` | 참고 사항 |
| `today_date` | 오늘 날짜 (자동) |

---

## 2-A: PDF 모드 (Cowork 환경)

Bash 도구로 아래 Python 스크립트를 실행한다.
저장 경로: `/sessions/fervent-wonderful-cray/mnt/시스템행거 AI 루마네/견적서_{고객명}_{날짜}.pdf`

```python
import sys
sys.path.insert(0, '/sessions/fervent-wonderful-cray/.local/lib/python3.10/site-packages')

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.pdfgen import canvas
import datetime

pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))

# ── 추출된 데이터 (여기를 채운다) ──────────────
customer_name = ""
customer_phone = ""
customer_address = ""
quote_amount = ""
payment_method = ""
shelf_color = ""
frame_color = ""
ceiling_height = ""
curtain_box = ""
structure_detail = ""
opt_drawer2 = ""
opt_drawer3 = ""
opt_pillar = ""
opt_shelf5 = ""
delivery_cost = ""
notes = ""
today_date = datetime.date.today().strftime('%Y-%m-%d')

color_val = " / ".join(filter(None, [
 f"선반: {shelf_color}" if shelf_color else "",
 f"프레임: {frame_color}" if frame_color else ""
]))

RED = colors.HexColor('#C0504D')
LGRAY = colors.HexColor('#D9D9D9')
DGRAY = colors.HexColor('#808080')
WHITE = colors.white
BLACK = colors.black
W, H = A4
M = 30
TW = W - 2 * M

def draw_cell(c, x, y, w, h, fill=None, text='', fsize=9,
 tcolor=BLACK, align='left', padding=5):
 c.saveState()
 if fill:
 c.setFillColor(fill); c.rect(x, y, w, h, fill=1, stroke=0)
 c.setStrokeColor(BLACK); c.setLineWidth(0.5)
 c.rect(x, y, w, h, fill=0, stroke=1)
 if text:
 c.setFillColor(tcolor); c.setFont('HYSMyeongJo-Medium', fsize)
 ty = y + h / 2 - fsize * 0.35
 if align == 'center': c.drawCentredString(x + w / 2, ty, str(text))
 else: c.drawString(x + padding, ty, str(text))
 c.restoreState()

date_str = today_date.replace('-', '')
name_part = f"_{customer_name}" if customer_name else ""
filename = f"견적서{name_part}_{date_str}.pdf"
output = f"/sessions/fervent-wonderful-cray/mnt/시스템행거 AI 루마네/{filename}"

cv = canvas.Canvas(output, pagesize=A4)
cur_y = [H - M]

def nr(h):
 cur_y[0] -= h
 return cur_y[0]

# 제목
ry = nr(36)
draw_cell(cv, M, ry, TW, 36, fill=WHITE)
cv.setFont('HYSMyeongJo-Medium', 16); cv.setFillColor(RED)
cv.drawCentredString(W/2, ry+36/2-6, '케이트블랑 드레스룸 견적서')
cv.setStrokeColor(BLACK); cv.setLineWidth(0.5); cv.rect(M, ry, TW, 36, fill=0, stroke=1)

# 고객명/날짜/전화
rh=22; ry=nr(rh)
for s,w,fill,txt,aln,fs in [
 (0,0.13,LGRAY,'고객명','center',9),(0.13,0.27,WHITE,customer_name,'left',9),
 (0.40,0.09,LGRAY,'날짜','center',9),(0.49,0.16,WHITE,today_date,'center',8),
 (0.65,0.08,LGRAY,'전화','center',9),(0.73,0.27,WHITE,customer_phone,'left',9)]:
 draw_cell(cv,M+TW*s,ry,TW*w,rh,fill=fill,text=txt,align=aln,fsize=fs)

# 주소
ry=nr(rh)
draw_cell(cv,M,ry,TW*0.13,rh,fill=LGRAY,text='주소',align='center')
draw_cell(cv,M+TW*0.13,ry,TW*0.87,rh,fill=WHITE,text=customer_address,align='left')

# 견적/결제방식
ry=nr(rh)
draw_cell(cv,M,ry,TW*0.13,rh,fill=LGRAY,text='견적',align='center')
draw_cell(cv,M+TW*0.13,ry,TW*0.27,rh,fill=WHITE,text=quote_amount,align='left')
draw_cell(cv,M+TW*0.40,ry,TW*0.18,rh,fill=LGRAY,text='결제방식',align='center')
draw_cell(cv,M+TW*0.58,ry,TW*0.42,rh,fill=WHITE,text=payment_method,align='left')

# 주문내역 헤더
ry=nr(rh)
draw_cell(cv,M,ry,TW,rh,fill=RED,text='주문내역',align='center',tcolor=WHITE,fsize=10)

# 색상/천장/커튼박스
ry6=nr(rh); ry7=ry6-rh
for rx,ry_,rw,rh_,fill,txt in [
 (M,ry7,TW*0.13,rh*2,LGRAY,'색상'),
 (M+TW*0.13,ry7,TW*0.33,rh*2,WHITE,color_val)]:
 cv.saveState()
 cv.setFillColor(fill); cv.rect(rx,ry_,rw,rh_,fill=1,stroke=0)
 cv.setStrokeColor(BLACK); cv.setLineWidth(0.5); cv.rect(rx,ry_,rw,rh_,fill=0,stroke=1)
 cv.setFillColor(BLACK); cv.setFont('HYSMyeongJo-Medium',9)
 if fill==LGRAY: cv.drawCentredString(rx+rw/2,ry_+rh_/2-4,txt)
 else: cv.drawString(rx+5,ry_+rh_/2-4,txt)
 cv.restoreState()
draw_cell(cv,M+TW*0.46,ry6,TW*0.14,rh,fill=LGRAY,text='천장',align='center')
draw_cell(cv,M+TW*0.60,ry6,TW*0.40,rh,fill=WHITE,text=ceiling_height,align='left')
draw_cell(cv,M+TW*0.46,ry7,TW*0.14,rh,fill=LGRAY,text='커튼박스',align='center',fsize=8)
draw_cell(cv,M+TW*0.60,ry7,TW*0.40,rh,fill=WHITE,text=curtain_box,align='left')
cur_y[0]=ry7

# 내용
ry=nr(rh)
draw_cell(cv,M,ry,TW*0.13,rh,fill=LGRAY,text='내용',align='center')
draw_cell(cv,M+TW*0.13,ry,TW*0.87,rh,fill=WHITE,text=structure_detail,align='left')

# 추가옵션 3행
oh=22; ry9=nr(oh); ry10=ry9-oh; ry11=ry10-oh
cv.saveState()
cv.setFillColor(LGRAY); cv.rect(M,ry11,TW*0.13,oh*3,fill=1,stroke=0)
cv.setStrokeColor(BLACK); cv.setLineWidth(0.5); cv.rect(M,ry11,TW*0.13,oh*3,fill=0,stroke=1)
cv.setFillColor(BLACK); cv.setFont('HYSMyeongJo-Medium',9)
cv.drawCentredString(M+TW*0.065,ry11+oh*1.5-4,'추가 옵션')
cv.restoreState()
for row,d2,d3,s5,bc in [(ry9,opt_drawer2,None,opt_shelf5,None),(ry10,opt_drawer3,None,None,delivery_cost),(ry11,opt_pillar,None,None,None)]:
 pass
draw_cell(cv,M+TW*0.13,ry9, TW*0.16,oh,fill=LGRAY,text='2단 서랍',align='center',fsize=8)
draw_cell(cv,M+TW*0.29,ry9, TW*0.17,oh,fill=WHITE,text=opt_drawer2,align='center')
draw_cell(cv,M+TW*0.46,ry9, TW*0.16,oh,fill=LGRAY,text='5단선반', align='center',fsize=8)
draw_cell(cv,M+TW*0.62,ry9, TW*0.38,oh,fill=WHITE,text=opt_shelf5, align='center')
draw_cell(cv,M+TW*0.13,ry10,TW*0.16,oh,fill=LGRAY,text='3단 서랍',align='center',fsize=8)
draw_cell(cv,M+TW*0.29,ry10,TW*0.17,oh,fill=WHITE,text=opt_drawer3,align='center')
draw_cell(cv,M+TW*0.46,ry10,TW*0.16,oh,fill=LGRAY,text='배송비', align='center',fsize=8)
draw_cell(cv,M+TW*0.62,ry10,TW*0.38,oh,fill=WHITE,text=delivery_cost,align='center')
draw_cell(cv,M+TW*0.13,ry11,TW*0.16,oh,fill=LGRAY,text='기둥추가',align='center',fsize=8)
draw_cell(cv,M+TW*0.29,ry11,TW*0.17,oh,fill=WHITE,text=opt_pillar,align='center')
draw_cell(cv,M+TW*0.46,ry11,TW*0.54,oh,fill=WHITE)
cur_y[0]=ry11

# 참고사항
ry=nr(36)
draw_cell(cv,M,ry,TW*0.13,36,fill=LGRAY,text='참고 사항',align='center',fsize=8)
draw_cell(cv,M+TW*0.13,ry,TW*0.87,36,fill=WHITE,text=notes,align='left')

# 평면도
ry=nr(22)
draw_cell(cv,M,ry,TW,22,fill=DGRAY,text='평면도',align='center',tcolor=WHITE)
plan_h=cur_y[0]-M-32; ry=nr(plan_h)
cv.setStrokeColor(BLACK); cv.setLineWidth(0.5); cv.rect(M,ry,TW,plan_h,fill=0,stroke=1)

# 푸터
ry=nr(30); fw=TW/4
draw_cell(cv,M, ry,fw,30,fill=LGRAY,text='(주)루마네시스템', align='center',fsize=8)
draw_cell(cv,M+fw, ry,fw,30,fill=LGRAY,text='기업은행 660-041655-04-011',align='center',fsize=7)
draw_cell(cv,M+fw*2,ry,fw,30,fill=LGRAY,text='사업자번호 : 793-81-02453', align='center',fsize=7)
draw_cell(cv,M+fw*3,ry,fw,30,fill=LGRAY,text='TEL 010-3784-5215', align='center',fsize=7)

cv.save()
print(f"✅ 견적서 PDF 생성 완료: {filename}")
```

완료 후 링크 제공:
```
견적서 만들어드렸어요
[견적서 열기](computer:///sessions/fervent-wonderful-cray/mnt/시스템행거 AI 루마네/{파일명})
```

---

## 2-B: 텍스트 모드 (채팅 환경)

Bash 도구 없이 채팅에서 실행될 때는 **HTML 코드를 절대 출력하지 않는다.**
대신 아래 텍스트 형식으로 견적 내용을 정리해서 출력한다.

```
[설치 공간]
-

[설치 예상 치수]
- 1면:
- 2면:
- (해당 면 없으면 생략)
- 합산:

[예상 구성]
- 기본 행거
- 선반
- (옵션 있으면 추가)

[금액]
- 기본 금액:
- 할인 적용:
- 최종 금액:

[배송비]
- 별도:

[안내]
- 본 견적은 도면 확정 전 예상 견적이며, 실제 시공 시 변경될 수 있습니다.
```

---

## 주의사항

- 고객 정보가 일부 없어도 빈칸으로 두고 반드시 생성한다
- Cowork: 저장 경로는 항상 `/sessions/fervent-wonderful-cray/mnt/시스템행거 AI 루마네/`
- Cowork: `sys.path.insert(0, '/sessions/fervent-wonderful-cray/.local/lib/python3.10/site-packages')` 반드시 포함
- 채팅: HTML 출력 후 반드시 "브라우저에서 인쇄 → PDF 저장" 방법 안내
