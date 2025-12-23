import prisma from "../db";
import { MoodMeter } from "@prisma/client";

type Callback<T> = (error: Error | null, result?: T) => void;

interface MoodData {
  user_id: number;
  label: string;
  color: string;
  pleasantness: number;
  energy: number;
}

interface ColorCountResult {
  color: string;
  count: number;
}

export const saveMoodMeter = async (
  moodData: MoodData,
  callback: Callback<MoodMeter>
): Promise<void> => {
  try {
    const { user_id, label, color, pleasantness, energy } = moodData;

    const result = await prisma.moodMeter.create({
      data: {
        user_id: parseInt(String(user_id)),
        label,
        color,
        pleasantness: parseInt(String(pleasantness)),
        energy: parseInt(String(energy)),
      },
    });

    callback(null, result);
  } catch (error) {
    console.error("Save mood meter error:", error);
    callback(error as Error, undefined);
  }
};

export const getMoodMeterByUserId = async (
  user_id: number,
  callback: Callback<MoodMeter[]>
): Promise<void> => {
  try {
    const result = await prisma.moodMeter.findMany({
      where: { user_id: parseInt(String(user_id)) },
    });

    callback(null, result);
  } catch (error) {
    console.error("Get mood meter error:", error);
    callback(error as Error, undefined);
  }
};

export const getLabelByUserId = async (
  user_id: number,
  callback: Callback<{ label: string }[]>
): Promise<void> => {
  try {
    const result = await prisma.moodMeter.findMany({
      where: { user_id: parseInt(String(user_id)) },
      select: { label: true },
      orderBy: { id: "desc" },
      take: 10,
    });

    callback(null, result);
  } catch (error) {
    console.error("Get label error:", error);
    callback(error as Error, undefined);
  }
};

export const getColorKeywordCountByUserId = async (
  user_id: number,
  callback: Callback<ColorCountResult[]>
): Promise<void> => {
  try {
    const result = await prisma.moodMeter.groupBy({
      by: ["color"],
      where: { user_id: parseInt(String(user_id)) },
      _count: {
        color: true,
      },
    });

    const formattedResult = result.map((item) => ({
      color: item.color,
      count: item._count.color,
    }));

    callback(null, formattedResult);
  } catch (error) {
    console.error("Get color keyword count error:", error);
    callback(error as Error, undefined);
  }
};

export const getRecentMoodColorsByUserId = async (
  user_id: number,
  callback: Callback<MoodMeter[]>
): Promise<void> => {
  try {
    const result = await prisma.moodMeter.findMany({
      where: { user_id: parseInt(String(user_id)) },
      orderBy: { id: "desc" },
      take: 10,
    });

    callback(null, result);
  } catch (error) {
    console.error("Get recent mood colors error:", error);
    callback(error as Error, undefined);
  }
};
