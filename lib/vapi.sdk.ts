import Vapi from "@vapi-ai/web";

let vapiInstance: Vapi | null = null;

export const getVapi = () => {
	const token = process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN;
	if (!token) return null;

	if (!vapiInstance) {
		vapiInstance = new Vapi(token);
	}

	return vapiInstance;
};
