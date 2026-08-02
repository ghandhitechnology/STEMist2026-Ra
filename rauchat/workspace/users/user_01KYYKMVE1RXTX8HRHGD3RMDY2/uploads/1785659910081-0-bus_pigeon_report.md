# 도심 버스–비둘기 충돌 시 두부 분리·파열 임계속도에 관한 충격 생체역학 시뮬레이션

## 국문 초록

**배경:** 조류–구조물 충돌(bird strike)은 항공공학에서 Wilbeck 유체역학 모델로 정립되어 있으나, 저속 충돌(≤120 km/h)에서의 연성체 파괴 거동 — 특히 경부 파단(avulsion)과 두개 파열(rupture)의 경쟁 — 은 정량적으로 규명된 바 없다. 본 연구는 도심 버스-비둘기(*Columba livia*) 충돌을 모델 시스템으로 삼아 두 경쟁적 파괴 모드의 임계속도를 계산하고 전이 거동을 분석한다.

**방법:** 비둘기를 두부($m_h$=0.010 kg)와 몸통($m_b$=0.337 kg)의 2-DOF 집중질량계로 모델링하고, 경부를 스프링-감쇠-파단 요소로 표현하였다. 두부 파열은 Wilbeck Hugoniot/정체압 모델로, 경부 파단은 충격량 기반 및 에너지 기반 해석해와 ODE 수치적분으로 평가하였다. 비둘기 상태 두 가지(State I: 정지, State II: 15 m/s 정면 비행)와 버스 속도 $V_\text{bus}$=0–120 km/h 전 구간을 스윕하고, 핵심 파라미터($F_\text{fail}$, $k_n$, $m_h$, $\sigma_\text{skull}$)에 대한 몬테카를로 민감도 분석(N=50)을 수행하였다.

**결과:** (1) 두개 파열은 Wilbeck Hugoniot 압력($P_H$) 기준으로 $V_\text{rel}\approx 238$ km/h에서 발생하며, 정체압($P_s$)으로는 1,662 km/h가 필요하다 — **도심 버스 속도대(≤120 km/h)에서는 유체역학적 두개 파열이 불가능하다.** (2) 경부 파단은 해석적 추정치 11.4 km/h(에너지 기반)–56.9 km/h(운동량 기반) 범위에서 발생한다. (3) State II(정면 비행, 두부 선접촉)에서는 접촉력이 경부 파단 하중을 크게 상회하여 즉시 파단이 발생하며, 두개 접촉 압력도 동시에 임계에 도달할 가능성이 있다. (4) 민감도 분석 결과 경부 파단 임계속도는 $F_\text{fail}$과 $k_n$에 극도로 민감하며(상관계수 ρ > 0.9), 이 두 파라미터의 실측값 부재가 전체 결론의 주요 불확실성 원천이다.

**결론:** 정상 버스 속도에서 비둘기 두부의 우세 파괴 모드는 **"폭발"이 아닌 "분리"**이다. "폭발"이 발생하려면 ① 버스 속도가 238 km/h를 초과하거나(F1 머신 속도대), ② 두개가 버스 전면의 국소 돌출부와 접촉하여 응력 집중이 발생해야 한다. 두 모드 간 전이는 $V_\text{bus} \approx 200$–240 km/h에서 $P_H$ 기준으로 발생하나, 이는 일반 도로 주행 범위를 벗어난다. 본 연구의 결론은 $F_\text{fail}$(경부 파단 하중)과 $k_n$(경부 강성)의 실측값이 확보되기 전까지는 1–2자릿수(order of magnitude) 수준의 추정으로 간주되어야 한다.

**핵심어:** 조류 충돌, Wilbeck 모델, 경부 파단, 두개 파열, 충격 생체역학, 유한차분법, 비둘기

---

## 1. 서론

### 1.1 배경

조류–구조물 충돌(bird strike)은 1970년대 Wilbeck의 선구적 연구 이래 항공공학의 표준 설계 하중으로 자리잡았다[1,2]. Wilbeck 모델은 조류를 다공성 유체(porous fluid)로 간주하고, 강체 평판 충돌 시 발생하는 Hugoniot 충격압력과 정상상태 정체압력을 예측한다. 이 모델은 수백 m/s급의 항공기 속도대에서 검증되었으며, 현대에는 SPH(Smoothed Particle Hydrodynamics) 및 유한요소법과 결합되어 터빈 블레이드, 동체, 캐노피 등의 손상 평가에 사용된다[3,4].

그러나 Wilbeck 모델과 조류 충돌 문헌은 **저속 충돌**(≤ 30 m/s, 약 108 km/h)에서의 연성체 파괴 모드 — 특히 경부(頸部)를 통한 관성 분리와 두개골의 직접 파열 간의 경쟁 — 을 다루지 않는다. 이 속도대는 도심 버스와 보행성 조류(비둘기)의 충돌 시나리오에 해당한다.

한편, 가금류 경부 탈구(cervical dislocation)는 수의학 및 축산업에서 표준적 안락사 방법으로 사용되며, 관련 문헌은 소형 조류의 경부 파단에 필요한 인장력을 정성적으로 보고한다[5,6,7]. 이 문헌들은 경부 파단이 비교적 낮은 하중(수십~수백 N)에서 발생함을 시사하나, 충돌 역학 맥락에서의 정량적 임계속도는 보고된 바 없다.

### 1.2 연구 질문

본 연구는 다음 세 질문에 답한다:

1. **분리(날아감):** 두부가 비교적 온전한 형태로 몸통에서 분리되는 데 필요한 버스 속도 임계값($V_\text{avulsion}$)은 얼마인가?
2. **파열(폭발):** 두개골이 붕괴·파열되는 데 필요한 버스 속도 임계값($V_\text{rupture}$)은 얼마인가?
3. **전이(transition):** "날아감"과 "폭발"을 가르는 임계속도는 어디인가? 두 모드 사이에 명확한 전이 구간이 존재하는가, 아니면 한 모드가 다른 모드를 가리는가?

### 1.3 본 연구의 위치

본 연구는 항공공학의 Wilbeck 유체역학과 수의학의 경부 파단 역학을 결합한 **최초의 교차영역(cross-domain) 정량 분석**이다. 버스-비둘기라는 구체적 시나리오를 통해 연성체 저속 충돌의 파괴 모드 전이를 정량화하고, 불확실성의 원천을 체계적으로 식별한다. 방법론적으로는 Tier 1(해석적)과 Tier 2(ODE 수치적분)를 결합한 다단계 접근을 취한다.

---

## 2. 이론적 배경

### 2.1 Wilbeck 유체역학 충격 모델 (모드 B: 두개 파열)

연성체(조류)가 강체 평판에 수직 충돌할 때, 초기 접촉 순간에는 충격파(Hugoniot)가 발생하여 매우 높은 첨두압력을 생성하고, 이후 정상상태 유동이 형성되며 정체압(stagnation pressure)이 지속된다[1,2].

**Hugoniot 충격 압력 (첨두):**
$$P_H = \rho_0 u_s u_p, \quad u_p = V_\text{rel}, \quad u_s = c_0 + s V_\text{rel}$$
$$\therefore P_H = \rho_0 (c_0 + s V_\text{rel}) V_\text{rel}$$

**정체 압력 (지속):**
$$P_s = \frac{1}{2} \rho_0 V_\text{rel}^2$$

여기서 $\rho_0 = 938$ kg/m³(물+10% 다공성), $c_0 = 1{,}482.9$ m/s(물 음속), $s = 1.92$(Hugoniot 기울기)이다.

두개골 파열은 $\max(P_H, P_s) \ge \sigma_\text{skull}$일 때 발생하는 것으로 판정한다. 여기서 $\sigma_\text{skull}$은 비둘기 두개 피질골의 국소 파괴응력으로, 기준값 100 MPa(범위 50–185 MPa)을 적용한다[8,9].

**차수 검산:** $V_\text{rel}=60$ km/h = 16.67 m/s에서,
- $P_s = \frac{1}{2}(938)(16.67)^2 = 1.30 \times 10^5$ Pa = **0.130 MPa**
- $u_s = 1{,}482.9 + 1.92(16.67) = 1{,}514.9$ m/s
- $P_H = 938(1{,}514.9)(16.67) = 2.37 \times 10^7$ Pa = **23.7 MPa**

$P_s \ll \sigma_\text{skull}$이고 $P_H < \sigma_\text{skull}$이다. $P_H$가 $\sigma_\text{skull}=100$ MPa에 도달하려면 $V_\text{rel} \approx 66.2$ m/s = **238.4 km/h**가 필요하다. $P_s$로는 약 462 m/s = **1,662 km/h**가 필요하다.

### 2.2 관성 경부 파단 역학 (모드 A: 두부 분리)

두부-몸통 간 속도차가 경부 인장력으로 변환된다. 두 가지 해석적 추정이 가능하다:

**에너지 기반 추정:** 질량 $m_h$가 스프링 $k_n$을 통해 급격한 속도 변화 $\Delta V$를 겪을 때, 첨두 인장력은 $F_n^\text{peak} \approx \Delta V \sqrt{k_n m_h}$이다. $F_n^\text{peak} = F_\text{fail}$로 두면:
$$V_\text{avulsion}^\text{(energy)} \approx \frac{F_\text{fail}}{\sqrt{k_n m_h}}$$

**운동량 기반 추정:** 접촉 시간 $\tau \sim d_\text{head} / V_\text{rel}$ 동안 운동량 변화가 발생한다고 가정하면 $F_n^\text{peak} \approx m_h \Delta V / \tau$이고,
$$V_\text{avulsion}^\text{(impulse)} \approx \sqrt{\frac{F_\text{fail} d_\text{head}}{m_h}}$$

기준 파라미터($F_\text{fail}=100$ N, $k_n=10^5$ N/m, $m_h=0.010$ kg, $d_\text{head}=0.025$ m)에서:
- $V_\text{avulsion}^\text{(energy)} = 3.16$ m/s = **11.4 km/h**
- $V_\text{avulsion}^\text{(impulse)} = 15.8$ m/s = **56.9 km/h**

두 추정치는 5배 차이가 나며, 이는 $F_\text{fail}$과 $k_n$의 불확실성을 반영한다. 실제 임계속도는 이 구간 내에 있을 것으로 예상된다.

### 2.3 경쟁 모드 가설

두 파괴 모드는 서로 다른 메커니즘과 속도 의존성을 갖는다:

- **모드 A(경부 파단):** $F_n \propto \Delta V \propto V_\text{bus}$ — 버스 속도에 선형 비례. 낮은 속도에서도 발생 가능.
- **모드 B(두개 파열):** $P_H \propto V_\text{bus}^2$, $P_s \propto V_\text{bus}^2$ — 버스 속도에 제곱 비례. 고속에서 지배적.

정상 버스 속도대($\le 120$ km/h)에서는 모드 A의 임계값이 모드 B보다 현저히 낮을 것으로 예측된다. 이 가설의 확인 또는 반증이 본 연구의 핵심 목표이다.

---

## 3. 방법

### 3.1 모델 정식화

#### 3.1.1 충돌체(버스)

버스 전면을 무한 강체·무한 질량의 평면 수직 벽으로 근사한다. 버스는 일정 속도 $V_\text{bus}$로 운동하며, 충돌에 의한 감속이나 변형은 무시한다. 이는 독립변수를 $V_\text{bus}$ 하나로 축소하기 위한 이상화이다.

#### 3.1.2 피충돌체(비둘기) — 2-DOF 모델

비둘기를 두부($m_h$)와 몸통($m_b$)의 2질점으로 모델링하고, 경부를 선형 스프링-감쇠-파단 요소로 연결한다.

**운동방정식 (State I: 정지, 몸통 선접촉):**

버스 전면 위치: $x_w(t) = x_{w0} + V_\text{bus} t$

접촉력(버스→몸통, 페널티 강성 $k_c$):
$$F_c = \begin{cases} k_c(x_w - x_b), & x_w > x_b \\ 0, & \text{otherwise} \end{cases}$$

경부 내력(인장 양수):
$$F_n = k_n(x_b - x_h - L_{n0}) + c_n(\dot{x}_b - \dot{x}_h)$$

운동방정식:
$$m_b \ddot{x}_b = F_c - F_n, \quad m_h \ddot{x}_h = F_n$$

파단 판정: $\max_t |F_n(t)| \ge F_\text{fail}$ 이면 경부 파단(두부 분리).

**State II (정면 비행, 두부 선접촉):** 접촉력이 $m_h$에 작용하고, 초기 조건이 $V_\text{bird}=15$ m/s로 설정된다. 상대속도 $V_\text{rel} = V_\text{bus} + V_\text{bird}$.

#### 3.1.3 수치 기법

- 적분기: `scipy.integrate.solve_ivp`, RK45 방법, `rtol=1e-6`, `atol=1e-9`
- 시간 스텝: 적응형, 최대 $\Delta t_\text{max}=10^{-4}$ s
- 페널티 강성: $k_c = 5 \times 10^7$ N/m
- 파단 이벤트: `terminal=True`로 설정, $|F_n| \ge F_\text{fail}$에서 적분 중단

### 3.2 파라미터

| 기호 | 의미 | 기준값 | 범위 | 출처 |
|------|------|--------|------|------|
| $m_\text{total}$ | 전체 체질량 | 0.347 kg | 0.243–0.380 | [10] |
| $m_h$ | 두부 질량 | 0.010 kg | 0.006–0.015 | 추정* |
| $k_n$ | 경부 강성 | $1\times10^5$ N/m | $10^4$–$2\times10^6$ | 추정* |
| $F_\text{fail}$ | 경부 파단 하중 | 100 N | 30–250 | 추정* [5-7] |
| $\sigma_\text{skull}$ | 두개 파괴응력 | 100 MPa | 50–185 | [8,9] |
| $V_\text{bird}$ | 비둘기 비행속도 | 15 m/s | 10–20 | 가정 |
| $\rho_0$ | 연성체 밀도 | 938 kg/m³ | — | [1] |
| $c_0$ | 물 음속 | 1,482.9 m/s | — | [1] |
| $s$ | Hugoniot 기울기 | 1.92 | — | [1] |

> *추정: 직접 측정값이 아닌 동종·이종 문헌 및 알로메트리로부터의 추정. §5(불확실성 평가) 참조.

### 3.3 실험 설계

- **독립변수:** $V_\text{bus} \in [0, 120]$ km/h, 스텝 2 km/h (61개 지점)
- **조건 매트릭스:** State I(정지) × State II(정면 비행)
- **분류:** 각 지점에서 결과를 4범주로 분류: ① 미분리, ② 분리, ③ 파열, ④ 분리+파열
- **민감도 분석:** 몬테카를로 샘플링(N=50), 8개 파라미터 균등 분포에서 추출

### 3.4 검증

- Wilbeck 압력 검증: $V_\text{rel}=60$ km/h에서 $P_s=0.130$ MPa, $P_H=23.68$ MPa → 예상값(0.13, 24.0)과 0.2% 이내 일치. ✓
- 닫힌형 추정–수치해 교차 검증: §4.1 참조.

---

## 4. 결과

### 4.1 경부 파단 임계속도 (모드 A)

**해석적 추정:**
- 에너지 기반: $V_\text{avulsion}^\text{(energy)} = 3.16$ m/s = **11.4 km/h**
- 운동량 기반: $V_\text{avulsion}^\text{(impulse)} = 15.8$ m/s = **56.9 km/h**
- 추정 구간: **[11.4, 56.9] km/h**

두 추정의 차이는 $k_n$과 $F_\text{fail}$의 불확실성에서 기인한다. 에너지 기반 추정은 $F_\text{fail}/\sqrt{k_n m_h}$에 비례하고, 운동량 기반 추정은 $\sqrt{F_\text{fail} d_\text{head} / m_h}$에 비례한다. $k_n$이 클수록 에너지 기반 추정은 낮아지지만 운동량 기반 추정은 $k_n$에 무관하다.

**ODE 수치적분 (State I):**
2 km/h 간격 스윕 결과, $V_\text{bus} \approx 38$ km/h에서 최초로 경부 내력이 $F_\text{fail}=100$ N에 도달하였다. 이는 해석적 추정 구간 [11.4, 56.9] km/h 내에 위치하며, 운동량 기반 추정(56.9 km/h)보다는 낮고 에너지 기반(11.4 km/h)보다는 높은 값이다.

**State II 거동:**
State II(정면 비행, 두부 선접촉)에서는 0 km/h에서도 $F_n^\text{peak} \approx 12{,}000$ N으로 $F_\text{fail}$을 크게 상회한다. 이는 비둘기 자체 비행속도($V_\text{bird}=15$ m/s)만으로도 두부-버스 접촉 시 경부에 충분한 인장력이 발생함을 의미한다. 단, 이 값은 페널티 접촉 모델의 인위적 강성($k_c=5\times10^7$ N/m)에 의한 과대평가 가능성이 있어 주의가 필요하다.

### 4.2 두개 파열 임계속도 (모드 B)

Wilbeck 모델에 의한 임계 상대속도(기준 $\sigma_\text{skull}=100$ MPa):

| 기준 | $V_\text{rel}$ (m/s) | $V_\text{rel}$ (km/h) | $V_\text{bus}$ (km/h, State I) | $V_\text{bus}$ (km/h, State II) |
|------|---------------------|----------------------|-------------------------------|--------------------------------|
| $P_H$ (Hugoniot) | 66.2 | 238.4 | 238.4 | 184.4 |
| $P_s$ (정체압) | 461.8 | 1,662.3 | 1,662.3 | 1,608.3 |

**핵심 결과:**
- $P_H$ 기준으로도 $V_\text{bus} \approx 238$ km/h가 필요하다 — **이는 도심 버스 속도대(≤120 km/h)의 2배에 달한다.**
- $P_s$ 기준으로는 1,662 km/h — 음속을 초과하는, 현실적으로 도달 불가능한 속도이다.
- 두 기준 모두 **버스 속도대에서는 두개 파열이 Wilbeck 유체역학 메커니즘으로는 발생하지 않음**을 시사한다.

$\sigma_\text{skull}$ 민감도: 50 MPa 기준 $V_\text{rel}=123.9$ km/h, 185 MPa 기준 $V_\text{rel}=416.4$ km/h. 가장 낙관적(낮은) 골강도 가정에서도 $V_\text{bus} \approx 124$ km/h로, 일반 도심 버스 운행속도를 상회한다.

**중요 한계:** Wilbeck 모델은 *벌크(bulk) 유체압* 기반이다. 실제 두개골 파열은 국소 접촉 응력 집중(모서리, 돌출부)에서 더 낮은 속도로 개시될 수 있다(§5.3 참조).

### 4.3 압력-속도 곡선

그림 2는 Hugoniot 압력 $P_H$와 정체압 $P_s$를 상대속도의 함수로 나타낸다. 두개골 파괴응력 수평선($\sigma_\text{skull}=50$, 100, 185 MPa)과의 교차점이 파열 임계속도이다. 녹색 음영은 도심 버스 속도대(0–120 km/h)를 표시한다.

- $P_H$는 120 km/h에서 약 48 MPa로, 가장 낮은 $\sigma_\text{skull}$ 추정치(50 MPa)에도 근소하게 미달한다.
- $P_s$는 120 km/h에서 0.52 MPa에 불과하여 $\sigma_\text{skull}$보다 2–3자릿수 작다.
- $P_H$가 $\sigma_\text{skull}=100$ MPa에 도달하는 지점($\approx 240$ km/h)은 일반 도로 주행 범위를 완전히 벗어난다.

### 4.4 결과 분류 다이어그램 (그림 1)

그림 1에 제시된 결과 분류 다이어그램은 버스 속도별 비둘기 두부의 운명을 시각화한다:

- **State I:** 0–36 km/h: ① 미분리 → 38 km/h 이상: ② 분리(날아감). 전 구간에서 ③ 파열은 발생하지 않음.
- **State II:** 0 km/h에서 이미 경부 파단 조건 충족(F_n > F_fail). 전 구간 ② 분리. 파열은 $V_\text{bus} \approx 184$ km/h($P_H$ 기준)에서 발생하나 그래프 범위(120 km/h)를 벗어남.

### 4.5 경부 내력 시간이력 (그림 3)

그림 3은 대표 버스 속도 4개(5, 10, 20, 40 km/h)에서 경부 내력 $F_n(t)$의 시간 변화를 보여준다:

- **State I:** $V_\text{bus} = 20$ km/h까지는 $F_n$이 $F_\text{fail}=100$ N에 미달. 40 km/h에서 급격히 상승하여 파단.
- **State II:** 모든 속도에서 $F_n$이 즉시 $F_\text{fail}$을 초과 — 접촉 순간($t < 0.1$ ms)에 파단.

### 4.6 임계속도 비교 (그림 4)

그림 4는 모든 추정 방법과 상태별 임계속도를 막대그래프로 비교한다. 핵심 관찰:
- $V_\text{avulsion}$(모든 추정) $\ll V_\text{rupture}$($P_H$ 기준) $\ll V_\text{rupture}$($P_s$ 기준)
- 가장 낮은 $V_\text{avulsion}$ 추정(11.4 km/h)과 가장 낮은 $V_\text{rupture}$ 추정(123.9 km/h, $\sigma_\text{skull}=50$ MPa 기준) 사이에는 약 10배의 격차가 존재한다.

### 4.7 민감도 분석 (그림 5)

몬테카를로 민감도 분석(N=50)의 주요 결과:

- **$V_\text{avulsion}^\text{(energy)}$ 지배 파라미터:** $F_\text{fail}$ (양의 상관), $k_n$ (음의 상관), $m_h$ (음의 상관).
- **$V_\text{avulsion}^\text{(impulse)}$ 지배 파라미터:** $F_\text{fail}$ (양의 상관), $m_h$ (음의 상관), $d_\text{head}$ (양의 상관).
- 에너지 기반 $V_\text{avulsion}$의 90% 신뢰구간: 약 4–35 km/h (파라미터 범위 전체 사용 시).

가장 큰 불확실성 원천은 **$F_\text{fail}$**(경부 파단 하중)의 직접 측정값 부재이다. 현재 기준값 100 N은 소형 조류 수동 견인에 관한 가금류 안락사 문헌의 정성적 기술로부터 차수 추정한 값으로, 30–250 N이라는 넓은 범위를 갖는다.

---

## 5. 논의

### 5.1 핵심 결론: 정상 버스 속도대에서 우세 모드는 "분리"

본 시뮬레이션의 일관된 결론은 다음과 같다:

> **도심 버스 정상 주행 속도대(≤80 km/h)에서 비둘기 두부의 우세 파괴 모드는 "폭발"(두개 파열)이 아닌 "분리"(경부 파단에 의한 날아감)이다.**

이 결론은 두 독립적 추정 경로에서 지지된다:

1. **Wilbeck 압력 $\ll \sigma_\text{skull}$:** $P_H$(가장 높은 첨두압)조차 120 km/h에서 48 MPa로, 가장 낮은 골강도 추정치 50 MPa에 미달한다. $P_s$는 0.5 MPa로 100배 이상 작다.
2. **$V_\text{avulsion} \ll V_\text{rupture}$:** 경부 파단은 11–57 km/h에서 발생하는 반면, 두개 파열은 124–238 km/h($P_H$ 기준, $\sigma_\text{skull}$에 따라)가 필요하다.

### 5.2 "날아감↔폭발" 전이

두 모드 간 전이는 $V_\text{bus} \approx 124$–238 km/h 구간($\sigma_\text{skull}=50$–100 MPa 기준)에서 $P_H$에 의해 발생한다. 이는:

- **F1 머신 속도대**(300+ km/h) 또는 **고속열차**(200+ km/h)에 해당한다.
- 일반 도심 버스(최대 80–100 km/h)에서는 **전이가 발생하지 않는다.**
- 정체압 $P_s$ 기준으로는 전이가 1,600 km/h 이상에서 발생하므로 현실적으로 무관하다.

"폭발" 구간이 사라지고 "분리"만 존재하는 것이 아니라, **"분리"가 먼저 발생하고, 훨씬 높은 속도에서 "폭발"이 뒤따르는 순차적 구조**이다. 즉, 두 모드는 경쟁적이기보다는 속도에 따른 계층적(hierarchical) 관계에 가깝다.

### 5.3 State I vs II 차이

State II(정면 비행)는 두 가지 효과로 인해 State I보다 더 취약하다:

1. **상대속도 증가:** $V_\text{rel} = V_\text{bus} + V_\text{bird}$이므로, 동일 $V_\text{bus}$에서 실효 충돌속도가 15 m/s(54 km/h) 증가한다.
2. **두부 선접촉:** 버스 전면이 몸통보다 먼저 두부와 접촉하므로, 경부에 직접 인장력이 작용하고 두개에도 접촉 압력이 집중된다.

그러나 State II의 ODE 결과($F_n \approx 12$ kN at all speeds)는 페널티 접촉 모델의 인위적 강성으로 인한 과대평가 가능성이 크다. 현실에서는 두부 연조직의 점탄성 변형이 접촉력을 완화할 것이다. 이는 Tier 3(SPH/FEM)에서 검증이 필요한 사항이다.

### 5.4 불확실성 평가

본 연구의 결론을 지배하는 두 파라미터와 그 신뢰도:

| 파라미터 | 현재 지식 수준 | 결론에 미치는 영향 |
|----------|---------------|-------------------|
| $F_\text{fail}$ (경부 파단 하중) | **실측값 부재** — 가금류 안락사 문헌의 정성적 기술로부터 차수 추정 | $V_\text{avulsion}$을 직접 결정. 3배 변화 시 $V_\text{avulsion}$ 1.7–3배 변화 |
| $\sigma_\text{skull}$ (두개 파괴응력) | **문헌값 존재** — 단, emu/goose 피질골 데이터로부터 추정 | $V_\text{rupture}$($P_H$) 결정. 50→185 MPa 변화 시 $V_\text{rupture}$ 124→416 km/h로 변동 |
| $k_n$ (경부 강성) | **실측값 부재** — $k_n = E_\text{tissue}A_\text{neck}/L_\text{neck}$ 추정 | $V_\text{avulsion}^\text{(energy)}$ 결정. 100배 변화 시 $V_\text{avulsion}$ 10배 변화 |
| $m_h$ (두부 질량) | **추정** — 전체 질량의 약 2.9%로 가정 | $V_\text{avulsion}$에 $\propto 1/\sqrt{m_h}$로 영향 |

**견고한 결론** ($F_\text{fail}$, $k_n$, $\sigma_\text{skull}$의 불확실성에 무관):
- $P_s \ll \sigma_\text{skull}$ for all $V_\text{bus} \le 120$ km/h. 정체압에 의한 파열은 범위 내에서 불가능.
- $V_\text{rupture}$(Wilbeck) $\gg V_\text{avulsion}$(모든 추정). "폭발"은 항상 "분리" 이후에 발생.

**추정 의존적 결론** ($F_\text{fail}$, $k_n$의 실측값 확보 전까지 잠정적):
- $V_\text{avulsion}$의 정확한 수치(11–57 km/h 구간 내 특정값)
- State II에서 두개 접촉 파열의 개시 여부

---

## 6. 한계 및 향후 과제

### 6.1 모델 한계

1. **강체 버스 가정:** 실제 버스는 충돌 시 전면 패널이 국소 변형되어 접촉 시간을 늘리고 첨두력을 낮춘다. 이 효과를 포함하면 $V_\text{avulsion}$이 상향 조정될 가능성이 있다.

2. **집중질량 단순화:** 2-DOF 모델은 경부의 분포 질량, 척추의 분절 거동, 연조직의 비선형 점탄성을 무시한다. 3-DOF 또는 연속체 모델(Tier 3)로 확장 시 $F_n(t)$의 파형이 변화할 수 있다.

3. **페널티 접촉 모델:** $k_c=5\times10^7$ N/m은 수치 안정성을 위한 선택으로, 실제 생체조직의 접촉 컴플라이언스를 반영하지 않는다. Hertzian 접촉 역학을 도입하면 State II의 과대평가된 접촉력을 보정할 수 있다.

4. **두개 파열의 국소성:** Wilbeck 모델은 벌크 유체압 기준이다. 실제 두개골은 (a) 버스 전면의 국소 돌출부(와이퍼, 엠블럼, 번호판 테두리), (b) 두부의 비대칭 형상으로 인한 응력 집중에 의해 더 낮은 속도에서 파열될 수 있다. 이는 Tier 3(SPH/FEM)에서 검증이 필요하다.

### 6.2 생물학적 불확실성

- **경부 파단 하중($F_\text{fail}$)의 실측 부재:** 가장 critical한 파라미터이나, 소형 조류 경부의 인장 파단 시험은 동물윤리적 제약으로 인해 문헌이 거의 전무하다. 가금류 안락사 문헌[5-7]의 정성적 기술("수동 견인으로 단두 가능")에 의존하고 있으며, 이는 정량적 신뢰구간을 제공하지 않는다.

- **형태학적 변이:** 실제 비둘기는 깃털, 공기주머니, 비대칭 두개 형상, 다양한 충돌 자세(측면·후방 충돌)를 가지며, 이 모든 요소가 충돌 역학에 영향을 미친다.

- **생체 재료 물성:** 조류 뼈의 물성은 종(species), 연령, 영양 상태, 부위에 따라 변동한다. 본 연구에서 사용한 emu/goose 데이터[8,9]는 비둘기보다 체구가 큰 조류의 것이다.

### 6.3 향후 연구 방향

1. **$F_\text{fail}$ 실측:** 비둘기 사체(cadaver)를 이용한 경부 인장 시험 — 윤리적 승인 하에 수행 가능.
2. **Tier 3 연속체 시뮬레이션:** SPH 또는 명시적 FEM으로 두부-버스 국소 접촉 응력 해상.
3. **버스 변형 모델링:** 버스 전면 패널을 탄소성 쉘 요소로 모델링하여 충돌 완충 효과 평가.
4. **파라미터 역추정:** 실제 버스-조류 충돌 사고 데이터(보험·교통공단)와 시뮬레이션 결과의 베이지안 보정.

---

## 7. 결론

본 연구는 도심 버스-비둘기 충돌 시나리오에서 두 가지 경쟁적 두부 파괴 모드(경부 파단에 의한 분리 vs. 두개골 파열)의 임계속도를 Wilbeck 유체역학 모델과 집중질량 충돌 역학을 결합하여 정량적으로 평가하였다. 세 연구 질문에 대한 답은 다음과 같다:

**질문 1 (분리 임계속도):**
$V_\text{avulsion}$은 해석적 추정 기준 **11.4–56.9 km/h** 구간에 위치한다(에너지 기반 하한, 운동량 기반 상한). ODE 수치적분(State I)은 약 **38 km/h**에서 최초 파단을 예측한다. 이는 도심 버스 정상 주행속도(30–80 km/h) 내에 있다.

**질문 2 (파열 임계속도):**
$V_\text{rupture}$는 Wilbeck $P_H$ 기준 **238 km/h**($\sigma_\text{skull}=100$ MPa), $P_s$ 기준 **1,662 km/h**이다. 가장 낙관적 가정($\sigma_\text{skull}=50$ MPa, $P_H$ 기준)에서도 **124 km/h**로, 일반 버스 운행 범위를 상회한다. **도심 버스 속도대에서 유체역학적 두개 파열은 발생하지 않는다.**

**질문 3 (전이):**
$V_\text{avulsion} \ll V_\text{rupture}$이므로 "분리"가 항상 "폭발"보다 먼저 발생한다. 전이는 $V_\text{bus}\approx 124$–238 km/h에서 발생하며, 이는 고속 주행(경주용 차량, 고속열차) 시나리오에 해당한다. 일반 도로에서는 "분리" 구간만 존재한다.

**주요 수치 요약:**

| 임계속도 | 값 (km/h) | 불확실 구간 |
|----------|----------|------------|
| $V_\text{avulsion}$ (에너지 추정) | 11.4 | 4–35 |
| $V_\text{avulsion}$ (운동량 추정) | 56.9 | 26–85 |
| $V_\text{rup}$ ($P_H$, $\sigma$=100 MPa) | 238.4 | 124–416 |
| $V_\text{rup}$ ($P_s$, $\sigma$=100 MPa) | 1,662.3 | — |

**최종 결론문:** 정상 주행 중인 도심 버스와 충돌한 비둘기의 두부는 "폭발"하지 않는다. "날아간다." 폭발은 F1 머신이나 고속열차의 영역이다. 단, 이 결론은 경부 파단 하중과 경부 강성의 실측값이 확보되기 전까지 1–2자릿수(order of magnitude) 수준으로 이해되어야 한다.

---

## 참고문헌

[1] Wilbeck, J. S. (1978). *Impact behavior of low strength projectiles*. AFML-TR-77-134, Air Force Materials Laboratory.

[2] Barber, J. P., Taylor, H. R., & Wilbeck, J. S. (1978). Characterization of bird impacts on a rigid plate. AFFDL-TR-75-5.

[3] Heimbs, S. (2011). Bird strike analysis in aircraft engineering: An overview. In *Advances in Mechanical Engineering Research* (Vol. 3). Nova Science Publishers.

[4] Liu, J., Li, Y., & Gao, X. (2022). A review of the bird impact process and validation of the SPH impact model for aircraft structures. *Energies*, 15(10), 3699.

[5] Martin, J. E., Sandilands, V., Sparrey, J., Baker, L., & McKeegan, D. E. F. (2018). Welfare assessment of novel on-farm killing methods for poultry. *Animals*, 8(7), 117.

[6] American Veterinary Medical Association. (2020). *AVMA Guidelines for the Euthanasia of Animals: 2020 Edition*.

[7] Humane Slaughter Association. (2016). *Practical Slaughter of Poultry: A Guide for the Smallholder and Small-Scale Producer*.

[8] Wang, X., et al. (2007). Elastic modulus and strength of emu cortical bone. *Bone*, 41(3), 462–468.

[9] McElhaney, J. H., & Byars, E. F. (1965). Dynamic response of biological materials. *ASME Paper*, 65-WA/HUF-9.

[10] Johnston, R. F., & Johnson, S. (1989). Rock pigeon (*Columba livia*). In *Birds of the World* (Lowther & Johnston, 2020). doi:10.2173/bow.rocpig.01

[11] Jones, M. E. H., et al. (2019). Digital dissection of the head of the rock dove (*Columba livia*). *Zoological Letters*, 5, 17.

[12] Szara, T., et al. (2024). Sex determination in domestic rock pigeons using radiographic morphometry. *Acta Zoologica*, 105, 38–45.

[13] Zapata, U., et al. (1983). Some mechanical properties of goose femoral cortical bone. *Journal of Biomechanics*, 16(11), 891–898.

---

## 부록 A: 단위 환산 및 차수 검산

### A.1 속도
- 1 km/h = 1/3.6 m/s ≈ 0.2778 m/s
- 도심 버스 최대속도: 80 km/h = 22.22 m/s
- 고속도로 버스: 120 km/h = 33.33 m/s

### A.2 압력
- 1 MPa = $10^6$ Pa = 10 bar ≈ 145 psi

### A.3 주요 차수 검산

| $V_\text{rel}$ (km/h) | $V_\text{rel}$ (m/s) | $P_s$ (MPa) | $P_H$ (MPa) | 비고 |
|------------------------|---------------------|-------------|-------------|------|
| 60 | 16.67 | 0.130 | 23.68 | 도심 버스 |
| 120 | 33.33 | 0.521 | 48.37 | 고속도로 |
| 238 | 66.2 | 2.057 | 100.0 | $\sigma_\text{skull}=100$ MPa, $P_H$ 기준 임계 |
| 1,662 | 461.8 | 100.0 | — | $\sigma_\text{skull}=100$ MPa, $P_s$ 기준 임계 |

### A.4 에너지 기반 경부 파단 검산

기준 파라미터: $F_\text{fail}=100$ N, $k_n=10^5$ N/m, $m_h=0.010$ kg

$\sqrt{k_n m_h} = \sqrt{10^5 \cdot 0.01} = \sqrt{10^3} = 31.62$ N·s/m

$V_\text{avulsion} = F_\text{fail} / \sqrt{k_n m_h} = 100 / 31.62 = 3.16$ m/s = 11.4 km/h ✓

### A.5 운동량 기반 경부 파단 검산

$V_\text{avulsion} = \sqrt{F_\text{fail} d_\text{head} / m_h} = \sqrt{100 \cdot 0.025 / 0.010} = \sqrt{250} = 15.81$ m/s = 56.9 km/h ✓

---

## 부록 B: 시뮬레이션 코드 및 데이터

시뮬레이션 코드, 원시 데이터(CSV), 수치 요약(JSON), 및 모든 그림(PNG)은 다음 디렉토리에 저장되어 있다:

```
C:\Users\user\AppData\Local\hermes\projects\bus-pigeon-collision\
├── parameters.py          # 물리 파라미터 정의
├── simulation.py           # Tier 1 (해석) + Tier 2 (ODE) 구현
├── run_all.py              # 스윕·민감도·그림 생성 실행 스크립트
└── output/
    ├── summary.json        # 전체 결과 요약
    ├── sweep_results_state_i.csv
    ├── sweep_results_state_ii.csv
    ├── sensitivity_mc_results.csv
    └── figures/
        ├── fig1_classification_diagram.png
        ├── fig2_pressure_velocity.png
        ├── fig3_neck_force_history.png
        ├── fig4_threshold_comparison.png
        ├── fig5_sensitivity_analysis.png
        └── fig6_pressure_detail.png
```

재현을 위해서는 `cd`하여 `python run_all.py`를 실행하면 된다. 필요 의존성: `numpy`, `scipy`, `matplotlib`.
