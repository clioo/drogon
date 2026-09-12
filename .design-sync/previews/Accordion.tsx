import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@drogon/desktop";

/** Single-open accordion with the first item expanded, matching typical settings-page usage. */
export function Default() {
  return (
    <Accordion type="single" defaultValue="item-1" collapsible className="w-full max-w-md">
      <AccordionItem value="item-1">
        <AccordionTrigger>What is Drogon?</AccordionTrigger>
        <AccordionContent>
          Drogon is a from-zero Rust core, daemon and desktop app rewrite.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>How do worktrees work?</AccordionTrigger>
        <AccordionContent>
          Each agent gets an isolated git worktree for its assigned task.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Is it open source?</AccordionTrigger>
        <AccordionContent>Yes, licensed under MIT.</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
