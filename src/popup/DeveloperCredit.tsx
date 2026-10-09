import { DEVELOPER } from '../shared/developer';

export default function DeveloperCredit() {
  return (
    <p className="developer">
      Developed by <a href={DEVELOPER.url} target="_blank" rel="noopener noreferrer">{DEVELOPER.name}</a>
    </p>
  );
}
