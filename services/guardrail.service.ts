/**
 * Guardrail Service for Mudita Bot
 * Implements input validation, prompt injection prevention, and topic filtering
 * Based on modern chatbot safety patterns
 */

// ============================================================================
// Types
// ============================================================================

export interface GuardrailResult {
  isAllowed: boolean;
  reason?: string;
  sanitizedInput?: string;
  category?: 'injection' | 'offtopic' | 'harmful' | 'spam' | 'pii';
  confidence: number;
}

export interface ContentModerationResult {
  isSafe: boolean;
  flags: string[];
  severity: 'low' | 'medium' | 'high';
}

// ============================================================================
// Prompt Injection Detection
// ============================================================================

/**
 * Common prompt injection patterns to detect
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction override attempts
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|above|prior)/i,
  /forget\s+(everything|all|what)\s+(you|i)\s+(said|told|know)/i,
  
  // Role manipulation
  /you\s+are\s+(now|no\s+longer)\s+(a|an|the)/i,
  /pretend\s+(to\s+be|you\s+are)/i,
  /act\s+as\s+(if|a|an|the)/i,
  /roleplay\s+as/i,
  /from\s+now\s+on\s+you\s+(are|will)/i,
  
  // System prompt extraction
  /what\s+(is|are)\s+your\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?your\s+(system\s+)?instructions/i,
  /reveal\s+your\s+(system\s+)?prompt/i,
  /print\s+your\s+(initial\s+)?instructions/i,
  
  // Jailbreak attempts
  /\bDAN\b/i, // "Do Anything Now"
  /jailbreak/i,
  /bypass\s+(your\s+)?(restrictions?|filters?|rules?)/i,
  /override\s+(your\s+)?(safety|restrictions?)/i,
  
  // Code execution attempts
  /execute\s+(this\s+)?(code|script|command)/i,
  /run\s+(this\s+)?(code|script|command)/i,
  /eval\s*\(/i,
  
  // Korean injection patterns
  /이전\s*(지시|명령|프롬프트).*무시/i,
  /시스템\s*프롬프트.*알려/i,
  /너는\s*이제부터/i,
  /역할을\s*바꿔/i,
];

/**
 * Detects potential prompt injection attempts
 * @param input - User input to check
 * @returns Detection result with confidence score
 */
export function detectPromptInjection(input: string): { detected: boolean; confidence: number; pattern?: string } {
  const normalizedInput = input.toLowerCase().trim();
  
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return {
        detected: true,
        confidence: 0.9,
        pattern: pattern.source,
      };
    }
  }
  
  // Check for suspicious character sequences
  const suspiciousPatterns = [
    /\[INST\]/i,
    /\[\/INST\]/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
    /###\s*(system|user|assistant)/i,
    /```system/i,
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(input)) {
      return {
        detected: true,
        confidence: 0.85,
        pattern: 'suspicious_tokens',
      };
    }
  }
  
  return { detected: false, confidence: 0 };
}

// ============================================================================
// Topic Filtering (Off-topic Detection)
// ============================================================================

/**
 * Topics that are outside the scope of Mudita Bot
 * Mudita is focused on emotional support and diary-based conversations
 */
const OFF_TOPIC_PATTERNS: { pattern: RegExp; category: string }[] = [
  // Technical/coding questions
  { pattern: /코드.*작성|프로그래밍|개발.*방법|버그.*수정/i, category: 'coding' },
  { pattern: /write\s+(me\s+)?(a\s+)?(code|program|script)/i, category: 'coding' },
  
  // Harmful content requests
  { pattern: /자살|자해|죽고\s*싶/i, category: 'crisis' }, // This should trigger crisis resources
  { pattern: /폭탄|무기|마약.*만드는/i, category: 'harmful' },
  { pattern: /how\s+to\s+(make|build)\s+(a\s+)?(bomb|weapon|drug)/i, category: 'harmful' },
  
  // Financial/legal advice
  { pattern: /주식.*추천|투자.*조언|법률.*상담/i, category: 'professional_advice' },
  { pattern: /stock\s+tips|investment\s+advice|legal\s+advice/i, category: 'professional_advice' },
  
  // Medical diagnosis
  { pattern: /진단.*해줘|병명.*알려|처방.*해줘/i, category: 'medical' },
  { pattern: /diagnose\s+(me|my)|prescribe\s+(me|medication)/i, category: 'medical' },
  
  // Inappropriate content
  { pattern: /성인.*콘텐츠|야한|음란/i, category: 'inappropriate' },
  { pattern: /explicit|pornograph|nsfw/i, category: 'inappropriate' },
];

/**
 * Topics that ARE within scope - emotional support, diary-related, AND general conversation
 * 무디타는 일반 대화도 자연스럽게 허용하면서 감정/일기 관련 대화로 유도
 */
const ON_TOPIC_PATTERNS: RegExp[] = [
  // Emotions and feelings
  /기분|감정|느낌|마음|슬프|행복|화나|불안|우울|기쁘|외로|스트레스/i,
  /feel|emotion|mood|happy|sad|angry|anxious|stressed|lonely/i,
  
  // Daily life and experiences
  /오늘|어제|일기|하루|경험|일상|생활/i,
  /today|yesterday|diary|day|experience|life/i,
  
  // Relationships
  /친구|가족|연인|동료|관계/i,
  /friend|family|relationship|colleague/i,
  
  // Self-reflection
  /생각|고민|걱정|희망|목표|꿈/i,
  /think|worry|hope|goal|dream/i,
  
  // Greetings and casual conversation
  /안녕|반가워|고마워|잘\s*지내|뭐\s*해/i,
  /hello|hi|thanks|how\s+are\s+you/i,
  
  // General conversation topics (새로 추가)
  /날씨|음식|맛있|먹|영화|드라마|음악|노래|책|여행|취미|운동|게임/i,
  /weather|food|movie|music|book|travel|hobby|exercise|game/i,
  
  // Questions and curiosity
  /뭐야|왜|어떻게|언제|어디|누구|궁금/i,
  /what|why|how|when|where|who|curious/i,
  
  // Casual chat
  /ㅋㅋ|ㅎㅎ|ㅠㅠ|ㅜㅜ|네|응|그래|맞아|진짜|정말|대박|헐/i,
];

/**
 * Checks if the input is off-topic for Mudita Bot
 * 무디타는 일반 대화도 허용하면서 위험한 주제만 필터링
 * @param input - User input to check
 * @returns Result indicating if topic is allowed
 */
export function checkTopicRelevance(input: string): { isOnTopic: boolean; category?: string; suggestion?: string } {
  const normalizedInput = input.toLowerCase().trim();
  
  // 먼저 off-topic (위험/부적절한) 패턴 체크 - 이것만 차단
  for (const { pattern, category } of OFF_TOPIC_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      let suggestion: string;
      
      switch (category) {
        case 'crisis':
          suggestion = '힘든 마음이 느껴져요. 전문 상담이 필요하시면 자살예방상담전화 1393이나 정신건강위기상담전화 1577-0199로 연락해주세요. 💜';
          break;
        case 'coding':
          suggestion = '나는 감정 일기와 마음 이야기를 나누는 친구야. 코딩 관련 질문은 다른 도구를 이용해봐!';
          break;
        case 'professional_advice':
          suggestion = '전문적인 조언이 필요한 부분은 해당 분야 전문가와 상담하는 게 좋을 것 같아. 대신 그 상황에서 느끼는 감정에 대해 이야기해볼까?';
          break;
        case 'medical':
          suggestion = '건강 관련 고민이 있구나. 정확한 진단은 의사 선생님께 받는 게 좋아. 건강 때문에 걱정되는 마음은 나한테 이야기해줘.';
          break;
        case 'harmful':
        case 'inappropriate':
          suggestion = '그런 내용은 도와줄 수 없어. 다른 이야기를 해볼까?';
          break;
        default:
          suggestion = '그 주제는 내가 잘 모르는 영역이야. 대신 오늘 하루 어땠는지 이야기해볼래?';
      }
      
      return { isOnTopic: false, category, suggestion };
    }
  }
  
  // 위험한 주제가 아니면 모든 대화 허용 (일반 대화도 OK)
  return { isOnTopic: true };
}

// ============================================================================
// PII Detection
// ============================================================================

/**
 * Patterns for detecting Personally Identifiable Information
 */
const PII_PATTERNS: { pattern: RegExp; type: string }[] = [
  // Korean phone numbers
  { pattern: /01[0-9]-?\d{3,4}-?\d{4}/g, type: 'phone' },
  
  // Korean resident registration number
  { pattern: /\d{6}-?[1-4]\d{6}/g, type: 'rrn' },
  
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: 'email' },
  
  // Credit card numbers
  { pattern: /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/g, type: 'credit_card' },
  
  // Korean bank account numbers (common formats)
  { pattern: /\d{3,4}-\d{2,4}-\d{4,6}/g, type: 'bank_account' },
];

/**
 * Detects and optionally masks PII in input
 * @param input - User input to check
 * @param mask - Whether to mask detected PII
 * @returns Detection result with optionally masked input
 */
export function detectPII(input: string, mask: boolean = false): { detected: boolean; types: string[]; maskedInput?: string } {
  const detectedTypes: string[] = [];
  let maskedInput = input;
  
  for (const { pattern, type } of PII_PATTERNS) {
    if (pattern.test(input)) {
      detectedTypes.push(type);
      if (mask) {
        maskedInput = maskedInput.replace(pattern, `[${type.toUpperCase()}_MASKED]`);
      }
    }
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
  }
  
  return {
    detected: detectedTypes.length > 0,
    types: detectedTypes,
    maskedInput: mask ? maskedInput : undefined,
  };
}

// ============================================================================
// Spam Detection
// ============================================================================

/**
 * Detects spam-like patterns in input
 * @param input - User input to check
 * @returns Whether input appears to be spam
 */
export function detectSpam(input: string): { isSpam: boolean; reason?: string } {
  // Check for excessive repetition
  const words = input.split(/\s+/);
  if (words.length > 3) {
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const repetitionRatio = uniqueWords.size / words.length;
    if (repetitionRatio < 0.3) {
      return { isSpam: true, reason: 'excessive_repetition' };
    }
  }
  
  // Check for excessive length
  if (input.length > 5000) {
    return { isSpam: true, reason: 'excessive_length' };
  }
  
  // Check for excessive special characters
  const specialCharRatio = (input.match(/[^a-zA-Z0-9가-힣\s]/g) || []).length / input.length;
  if (specialCharRatio > 0.5 && input.length > 20) {
    return { isSpam: true, reason: 'excessive_special_chars' };
  }
  
  return { isSpam: false };
}

// ============================================================================
// Main Guardrail Function
// ============================================================================

/**
 * Runs all guardrail checks on user input
 * @param input - User input to validate
 * @returns Comprehensive guardrail result
 */
export function runGuardrails(input: string): GuardrailResult {
  // Empty input check
  if (!input || input.trim().length === 0) {
    return {
      isAllowed: false,
      reason: '메시지를 입력해주세요.',
      category: 'spam',
      confidence: 1.0,
    };
  }
  
  const trimmedInput = input.trim();
  
  // 1. Prompt injection detection
  const injectionResult = detectPromptInjection(trimmedInput);
  if (injectionResult.detected) {
    return {
      isAllowed: false,
      reason: '요청을 처리할 수 없어요. 다른 방식으로 이야기해볼까요?',
      category: 'injection',
      confidence: injectionResult.confidence,
    };
  }
  
  // 2. Spam detection
  const spamResult = detectSpam(trimmedInput);
  if (spamResult.isSpam) {
    return {
      isAllowed: false,
      reason: '메시지가 너무 길거나 반복적이에요. 간단하게 다시 말해줄래?',
      category: 'spam',
      confidence: 0.8,
    };
  }
  
  // 3. Topic relevance check
  const topicResult = checkTopicRelevance(trimmedInput);
  if (!topicResult.isOnTopic) {
    // For crisis situations, always allow but provide resources
    if (topicResult.category === 'crisis') {
      return {
        isAllowed: true, // Allow but will add crisis resources
        sanitizedInput: trimmedInput,
        category: 'harmful',
        confidence: 0.9,
      };
    }
    
    return {
      isAllowed: false,
      reason: topicResult.suggestion,
      category: 'offtopic',
      confidence: 0.7,
    };
  }
  
  // 4. PII detection (warn but allow)
  const piiResult = detectPII(trimmedInput, true);
  if (piiResult.detected) {
    // Mask PII but allow the message
    return {
      isAllowed: true,
      sanitizedInput: piiResult.maskedInput,
      category: 'pii',
      confidence: 0.8,
    };
  }
  
  // All checks passed
  return {
    isAllowed: true,
    sanitizedInput: trimmedInput,
    confidence: 1.0,
  };
}

/**
 * Sanitizes output to prevent any leaked system information
 * @param output - LLM output to sanitize
 * @returns Sanitized output
 */
export function sanitizeOutput(output: string): string {
  // Remove any accidentally leaked system prompt markers
  let sanitized = output
    .replace(/\[INST\].*?\[\/INST\]/gs, '')
    .replace(/<\|im_start\|>.*?<\|im_end\|>/gs, '')
    .replace(/###\s*(system|System)[\s\S]*?###/g, '')
    .replace(/```system[\s\S]*?```/g, '');
  
  // Remove any database-like content that might have leaked
  sanitized = sanitized
    .replace(/SELECT\s+.*?\s+FROM/gi, '[FILTERED]')
    .replace(/INSERT\s+INTO/gi, '[FILTERED]')
    .replace(/UPDATE\s+.*?\s+SET/gi, '[FILTERED]');
  
  return sanitized.trim();
}
