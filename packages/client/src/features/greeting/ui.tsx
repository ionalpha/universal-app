import { z } from "zod";
import { Button } from "../../components/button";
import { Form, TextField, useZodForm } from "../../components/form";
import { toast } from "../../lib/toast";

const GreetSchema = z.object({
  name: z.string().min(1, "Enter your name"),
});

/** Demonstrates the form kit: one Zod schema drives validation + toast on submit. */
export function GreetingForm() {
  const form = useZodForm(GreetSchema);
  return (
    <Form
      form={form}
      className="space-y-3"
      onSubmit={({ name }) => {
        toast.success(`Hello, ${name}!`);
        form.reset();
      }}
    >
      <TextField name="name" label="Your name" placeholder="Ada Lovelace" />
      <Button type="submit">Say hello</Button>
    </Form>
  );
}
