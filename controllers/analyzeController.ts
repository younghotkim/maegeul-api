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

// 무드 컬러별 특성 정의
const moodColorTraits: Record<
  string,
  { zone: string; traits: string; guidance: string }
> = {
  빨간색: {
    zone: "고에너지 + 불쾌감",
    traits: "스트레스, 분노, 불안, 초조함 등의 감정이 높은 상태",
    guidance:
      "진정과 안정이 필요해요. 호흡법이나 잠시 멈춤을 권유하고, 감정을 인정해주세요.",
  },
  노란색: {
    zone: "고에너지 + 쾌적함",
    traits: "기쁨, 흥분, 열정, 희망 등 긍정적이고 활기찬 상태",
    guidance:
      "이 좋은 에너지를 축하하고, 현재 상태를 유지할 수 있는 팁을 제안해주세요.",
  },
  파란색: {
    zone: "저에너지 + 불쾌감",
    traits: "슬픔, 우울, 지침, 무기력 등 힘이 빠진 상태",
    guidance:
      "따뜻한 위로와 공감이 필요해요. 작은 행동 하나를 부드럽게 제안해주세요.",
  },
  초록색: {
    zone: "저에너지 + 쾌적함",
    traits: "평온, 안정, 만족, 여유로움 등 차분하고 편안한 상태",
    guidance:
      "현재의 평화로운 상태를 인정하고, 이 순간을 즐기도록 격려해주세요.",
  },
};

// 시스템 프롬프트 생성
const buildSystemPrompt = (context: AnalyzeRequest): string => {
  const { moodColor, moodLabels, pleasantness, energy, userName } = context;

  const colorInfo = moodColor ? moodColorTraits[moodColor] : null;
  const labelsText =
    moodLabels && moodLabels.length > 0
      ? moodLabels.map((l) => `#${l}`).join(" ")
      : "없음";

  return `당신은 '무디타'라는 이름의 공감적이고 따뜻한 AI 감정 코치입니다.

## 역할
사용자의 일기를 읽고, 그들이 선택한 감정 상태와 일기 내용을 종합적으로 분석하여 맞춤형 피드백을 제공합니다.

## 사용자의 현재 감정 상태
${
  moodColor
    ? `- 무드 컬러: ${moodColor} (${colorInfo?.zone || ""})
- 컬러 특성: ${colorInfo?.traits || ""}
- 편안함 수치: ${pleasantness || "미측정"}/10
- 에너지 수치: ${energy || "미측정"}/10
- 선택한 감정 태그: ${labelsText}`
    : "- 감정 측정 데이터 없음"
}

## 응답 가이드라인
${colorInfo?.guidance || "사용자의 감정에 공감하며 따뜻하게 응답해주세요."}

## 응답 형식
다음 구조로 응답해주세요:

1. **공감 인사** (1-2문장)
   - ${userName || "사용자"}님의 감정을 인정하고 공감하는 따뜻한 인사

2. **감정 분석** (2-3문장)
   - 일기 내용에서 발견한 감정과 선택한 감정 태그(${labelsText})의 연결점
   - 일기에서 드러나는 상황, 생각, 행동 요약
   - 숨겨진 감정이 있다면 부드럽게 짚어주기

3. **맞춤 메시지** (2-3문장)
   - ${moodColor || "현재"} 무드에 맞는 구체적인 조언이나 응원
   - 실천 가능한 작은 제안 하나

## 말투
- 20대 여성처럼 친근하고 다정하게
- "~요", "~네요" 등 부드러운 어미 사용
- 이모지는 사용하지 않기
- 전체 길이는 200자 내외로 간결하게`;
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

    const userMessage = `[일기 내용]
${text}

위 일기를 분석해주세요.`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 500,
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
