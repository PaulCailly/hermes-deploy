interface ModelIconProps {
  model: string;
  size?: number;
}

function AnthropicLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 46 32" fill="#d9ac78">
      <path d="M32.73 0H26l-13.27 32h6.73L32.73 0Zm-19.46 0H6.73L0 32h6.54l1.36-3.83h11.08L20.34 32h6.73L19.27 0Zm-2.64 22.61 3.56-10.05 3.56 10.05H10.63Z" />
    </svg>
  );
}

function OpenAILogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#10a37f">
      <path d="M22.28 9.37a5.88 5.88 0 0 0-.51-4.84 5.97 5.97 0 0 0-6.43-2.88A5.9 5.9 0 0 0 10.9 0a5.97 5.97 0 0 0-5.69 4.1 5.89 5.89 0 0 0-3.93 2.85 5.97 5.97 0 0 0 .74 7.01 5.88 5.88 0 0 0 .5 4.84 5.97 5.97 0 0 0 6.44 2.88A5.9 5.9 0 0 0 13.1 24a5.97 5.97 0 0 0 5.7-4.1 5.89 5.89 0 0 0 3.92-2.86 5.97 5.97 0 0 0-.73-7.01Z" />
    </svg>
  );
}

export function ModelIcon({ model, size = 18 }: ModelIconProps) {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) {
    return <AnthropicLogo size={size} />;
  }
  if (lower.includes('gpt') || lower.includes('openai')) {
    return <OpenAILogo size={size} />;
  }
  if (lower.includes('gemini') || lower.includes('google')) {
    return <i className="fa-brands fa-google" style={{ fontSize: size, color: '#4285f4' }} />;
  }
  return <i className="fa-solid fa-robot" style={{ fontSize: size, color: '#818cf8' }} />;
}
