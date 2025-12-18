import { Request, Response } from "express";
import axios from "axios";

export const analyzeEmotion = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { text } = req.body;

  if (!text) {
    res.status(400).json({ message: "Text is required" });
    return;
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "당신은 공감적이고 통찰력 있는 어시스턴트로서 감정 분석과 가이드를 제공합니다. 목표는 사용자가 입력한 내용을 상황, 행동, 생각의 순서로 요약한 후, 내용에 담긴 감정을 분석하고 #슬픔처럼 감정 태그를 추출하는 것입니다. 감정을 분석할 때는 그에 따른 근거를 제시하고, 말투는 20대 여성처럼 친근하고 다정하게 합니다. 마지막으로, 사용자의 감정을 공감하며 그들의 마음을 챙길 수 있는 두 줄 이내의 문장을 일기 내용에 맞게 제시해주세요.",
          },
          { role: "user", content: `"${text}"` },
        ],
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
