import { PierreMascot } from '../components/ui/PierreMascot';
import { Card, Muted, Stack } from '../components/ui/primitives';

/** Mostrado quando as variáveis do Supabase não existem. Nunca simulamos uma conexão. */
export function SetupRequired() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '56px 16px' }}>
      <Stack $gap={20}>
        <PierreMascot size={72} mood="calm" />
        <h1 style={{ fontSize: 30 }}>Falta conectar o Supabase</h1>
        <Muted>
          O Pierre Casa guarda tudo no seu próprio banco PostgreSQL do Supabase. Sem as chaves, o app não tem
          onde salvar.
        </Muted>
        <Card>
          <Stack $gap={10}>
            <strong>Para configurar:</strong>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>
                Crie um projeto em supabase.com e aplique as migrations de <code>supabase/migrations</code>.
              </li>
              <li>
                Copie <code>.env.example</code> para <code>.env.local</code>.
              </li>
              <li>
                Preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (chave pública).
              </li>
              <li>Reinicie o servidor de desenvolvimento.</li>
            </ol>
            <Muted $small>
              Detalhes completos no README. Nunca coloque a chave <code>service_role</code> no front-end.
            </Muted>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
