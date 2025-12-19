import { Request, Response } from "express";
import axios from "axios";

interface AnalyzeRequest {
  text: string;
  moodColor?: string;
  moodLabels?: string[];
  pleasantness?: number;
  energy?: number;
  userName?: string;
}

// 무드 컬러별 심리학적 특성 (LLM 컨텍스트용)
const moodColorTraits: Record<
  string,
  { 
    zone: string; 
    psychologyNote: string;
    approachTip: string;
  }
> = {
  빨간색: {
    zone: "고에너지 + 불쾌감",
    psychologyNote: "교감신경이 활성화된 상태로, 스트레스 호르몬(코르티솔)이 높을 수 있음. 감정 조절이 어려울 수 있으니 먼저 신체적 안정이 필요함.",
    approachTip: "감정을 부정하지 말고 인정해주되, 신체 기반 진정법(호흡, 냉각, 움직임)을 일기 내용과 연결해서 제안해줘.",
  },
  노란색: {
    zone: "고에너지 + 쾌적함",
    psychologyNote: "도파민과 세로토닌이 균형 잡힌 최적의 상태. 이 긍정적 경험을 기억에 각인시키면 회복탄력성이 높아짐.",
    approachTip: "이 좋은 순간을 축하하고, 일기에 나온 긍정적 경험을 강화할 수 있는 후속 활동을 제안해줘.",
  },
  파란색: {
    zone: "저에너지 + 불쾌감",
    psychologyNote: "부교감신경 과활성 또는 에너지 고갈 상태. 작은 성취감이 회복에 도움됨. 큰 변화보다 미세한 행동이 효과적.",
    approachTip: "따뜻하게 공감하고, 일기에서 언급된 상황에 맞는 아주 작고 쉬운 자기돌봄 활동을 제안해줘.",
  },
  초록색: {
    zone: "저에너지 + 쾌적함",
    psychologyNote: "이상적인 휴식 상태. 마음챙김과 현재 순간 인식이 잘 되어있음. 이 평온함을 유지하고 음미하는 것이 중요.",
    approachTip: "현재의 평화로운 상태를 인정하고, 일기 내용에서 좋았던 점을 짚어주며 이 순간을 즐기도록 격려해줘.",
  },
};

// 시스템 프롬프트 생성
const buildSystemPrompt = (context: AnalyzeRequest): string => {
  const { moodColor, moodLabels, pleasantness, energy, userName } = context;

  const colorInfo = moodColor ? moodColorTraits[moodColor] : null;
  const labelsText =
    moodLabels && moodLabels.length > 0
      ? moodLabels.join(", ")
      : "";

  const displayName = userName || "친구";

  return `당신은 '무디타'라는 이름의 따뜻한 친구예요. ${displayName}에게 진심 어린 편지를 써주세요.

## ${displayName}의 감정 데이터 (참고용, 편지에 그대로 언급하지 말 것)
${moodColor ? `
- 무드 존: ${colorInfo?.zone || ""}
- 심리학적 배경: ${colorInfo?.psychologyNote || ""}
${labelsText ? `- 감정 키워드: ${labelsText}` : ""}
${pleasantness !== undefined ? `- 편안함 수치: ${pleasantness}/10` : ""}
${energy !== undefined ? `- 에너지 수치: ${energy}/10` : ""}
- 접근 팁: ${colorInfo?.approachTip || "따뜻하게 공감해주세요."}
` : ""}

## 핵심 규칙
1. **일기 내용 기반 개인화**: 일기에 나온 구체적인 상황, 사람, 장소, 행동을 직접 언급하며 공감
2. **맞춤 솔루션**: 일기 내용과 연결된 구체적인 활동 제안 (일반적인 "산책하기", "음악듣기" 금지)
   - 예: 일기에 "카페"가 나오면 → "내일 그 카페에서 좋아하는 음료 한 잔 어때?"
   - 예: "친구"가 나오면 → "그 친구한테 오늘 고마웠다고 짧게 연락해보는 건?"
3. **감정 데이터 활용**: 편안함/에너지 수치를 참고해서 톤 조절 (수치 자체는 언급 X)

## 편지 구조 (자연스럽게, 섹션 구분 없이)
- "${displayName}아/야," 로 시작
- 일기 내용 구체적 언급 + 공감 (2-3문장)
- 심리학적 인사이트를 친근하게 풀어서 (1문장)
- 일기 내용 기반 맞춤 제안 (1-2가지)
- 따뜻한 마무리 + "무디타가"

## 말투
- 친한 언니/오빠가 쓴 것처럼 다정한 반말
- 이모지 2-3개 (💛🌿🌸☁️✨ 등 부드러운 것)
- "힘내", "괜찮아", "화이팅", "넌 할 수 있어" 같은 상투적 표현 절대 금지
- "~했구나", "~였겠다", "~한 거 읽었어" 식으로 공감
- 전체 250-350자`;
};

export const analyzeEmotion = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    text,
    moodColor,
    moodLabels,
    pleasantness,
    energy,
    userName,
  }: AnalyzeRequest = req.body;

  if (!text) {
    res.status(400).json({ message: "Text is required" });
    return;
  }

  try {
    const systemPrompt = buildSystemPrompt({
      text,
      moodColor,
      moodLabels,
      pleasantness,
      energy,
      userName,
    });

    const userMessage = `${userName || "친구"}가 오늘 쓴 일기야:

"${text}"

이 일기를 읽고 ${userName || "친구"}에게 친한 친구처럼 따뜻한 편지를 써줘. 섹션 구분 없이 자연스러운 편지 형식으로.`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.8,
        max_tokens: 600,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const emotionAnalysis = response.data.choices[0].message.content.trim();
    res.json({ emotion: emotionAnalysis });
  } catch (error: any) {
    console.error(
      "OpenAI API Error:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ message: "Error analyzing emotion" });
  }
};
