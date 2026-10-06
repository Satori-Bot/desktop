import { useState } from "react";
import type { MouseEvent } from "react";
import { PasswordInput } from "@mantine/core";
import type { PasswordInputProps } from "@mantine/core";
import type { Translate } from "../i18n";

type SecretInputProps = Omit<
  PasswordInputProps,
  "visible" | "onVisibilityChange" | "visibilityToggleButtonProps"
> & { t: Translate };

export function SecretInput({ t, ...props }: SecretInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <PasswordInput
      {...props}
      visible={visible}
      onVisibilityChange={setVisible}
      visibilityToggleButtonProps={{
        "aria-label": t("Toggle password visibility"),
        tabIndex: 0,
        // Mantine handles pointer-down and Space. Enter and assistive
        // technology activate the button with a synthesized click instead.
        onClick: (event: MouseEvent<HTMLButtonElement>) => {
          if (event.detail === 0) setVisible((current) => !current);
        },
      }}
    />
  );
}
