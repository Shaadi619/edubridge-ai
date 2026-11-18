import React from "react";

export function renderText(text: string) {
  return text.split("\n").map((line, i) => {
    return line
      ? <p key={i} className="mb-1 last:mb-0">{line.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
          part.startsWith("**") && part.endsWith("**")
            ? <strong key={index}>{part.slice(2, -2)}</strong>
            : <React.Fragment key={index}>{part}</React.Fragment>)}</p>
      : <br key={i} />;
  });
}
