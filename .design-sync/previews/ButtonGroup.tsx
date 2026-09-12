import { Button, ButtonGroup } from "@drogon/desktop";

/** Horizontal (default) button group. */
export function Horizontal() {
  return (
    <ButtonGroup>
      <Button variant="outline">Left</Button>
      <Button variant="outline">Middle</Button>
      <Button variant="outline">Right</Button>
    </ButtonGroup>
  );
}

/** Vertical orientation. */
export function Vertical() {
  return (
    <ButtonGroup orientation="vertical" className="w-32">
      <Button variant="outline">Top</Button>
      <Button variant="outline">Middle</Button>
      <Button variant="outline">Bottom</Button>
    </ButtonGroup>
  );
}
