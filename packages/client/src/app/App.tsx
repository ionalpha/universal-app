import { AppShell } from "../components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Container, HStack, Stack } from "../components/layout";
import { PageHeader } from "../components/page-header";
import { EmptyState } from "../components/states";
import { ThemeToggle } from "../components/theme-toggle";
import { CounterButton } from "../features/counter";
import { GreetingForm } from "../features/greeting";
import { HealthStatus } from "../features/health-status";
import { APP_NAME } from "./app-name";
import { AppProviders } from "./providers";

export interface AppProps {
  /** Which shell is rendering this shared frontend. */
  platform: string;
  /** Base URL of the Hono API. */
  apiUrl: string;
}

/**
 * The single shared frontend. web, desktop, iOS and Android all mount THIS
 * component - one artifact, four targets - composed from the design system.
 */
export function App({ platform, apiUrl }: AppProps) {
  return (
    <AppProviders>
      <AppShell
        header={
          <Container>
            <HStack className="h-14 justify-between">
              <span className="font-semibold">{APP_NAME}</span>
              <ThemeToggle />
            </HStack>
          </Container>
        }
        footer={
          <Container>
            <p className="py-4 text-center text-xs text-muted-foreground">
              web · desktop · iOS · Android - one shared frontend
            </p>
          </Container>
        }
      >
        <Container className="py-8">
          <Stack className="gap-6">
            <PageHeader
              title="Welcome"
              description={`Running on ${platform}`}
              actions={<CounterButton />}
            />
            <Card>
              <CardHeader>
                <CardTitle>API health</CardTitle>
              </CardHeader>
              <CardContent>
                <HealthStatus apiUrl={apiUrl} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Form kit</CardTitle>
              </CardHeader>
              <CardContent>
                <GreetingForm />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState title="Nothing yet" description="Your data will show up here." />
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </AppShell>
    </AppProviders>
  );
}
